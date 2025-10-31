import { geoJSON, polygon, featureGroup } from '../../vendors/leaflet/leaflet-src.esm.js'

// Expose two functions: applyFranceMask(map) and removeFranceMask(map)
const MASK_ID = 'umap-france-mask'

async function loadFranceGeoJSON() {
  // Load Natural Earth admin-0 boundaries
  const resp = await fetch(
    'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson'
  )

  if (!resp.ok) throw new Error('Failed to load countries geojson')

  const data = await resp.json()

  // Filter for France (ISO_A3 === 'FRA')
  const france = data.features.find((f) => f.properties.name === 'France')

  if (!france) throw new Error('France feature not found')

  // Return a FeatureCollection for consistency
  return {
    type: 'FeatureCollection',
    features: [france],
  }
}

function makeInversePolygon(franceFeature) {
  // Create a big rectangle covering the world and use France polygon as a hole
  // Leaflet uses [lat, lng]
  const outer = [
    [[-90, -180], [-90, 180], [90, 180], [90, -180], [-90, -180]]
  ]

  // Convert geojson coordinates [lng, lat] to [lat, lng] for Leaflet polygon
  const holes = franceFeature.geometry.coordinates.map((ring) =>
    ring.map(([lng, lat]) => [lat, lng])
  )

  // Polygon with holes: first ring is outer, following are holes
  // We'll return an array compatible with L.polygon
  return [outer[0].concat(holes[0])]
}

function getFranceHoles(franceFeature) {
  const coords = franceFeature.geometry.coordinates
  let holes = []

  if (franceFeature.geometry.type === 'Polygon') {
    // Single polygon
    holes = coords.map((ring) => ring.map(([lng, lat]) => [lat, lng]))
  } else if (franceFeature.geometry.type === 'MultiPolygon') {
    // Multiple polygons
    coords.forEach((poly) => {
      poly.forEach((ring) => {
        holes.push(ring.map(([lng, lat]) => [lat, lng]))
      })
    })
  }

  return holes
}


export async function applyFranceMask(map) {
  removeFranceMask(map)
  try {
    const geojson = await loadFranceGeoJSON()
    if (!geojson.features?.length) return
    const france = geojson.features[0]

    const outer = [
      [90, -180],
      [90, 180],
      [-90, 180],
      [-90, -180],
    ]

    // Shift the mask by ~1 km to the south and west (bottom and left).
    // We compute per-point degree offsets because longitude degrees vary with latitude.
    const shiftKm = 1 // kilometers to shift (positive value)

    // Additionally expand (inflate) the polygon by a small amount so the
    // masked area definitely covers nearby tiles/features. This is an
    // outward radial expansion of `expandKm` after the shift.
    const expandKm = 1 // kilometers to expand outward

    function shiftPoint([lat, lng]) {
      // Approximate conversions:
      //  - 1 degree latitude ~= 110.574 km (varies slightly with lat)
      //  - 1 degree longitude ~= 111.320 * cos(lat) km
      const latDegPerKm = 1 / 110.574
      const dLat = -shiftKm * latDegPerKm // negative -> move south

      // Protect against cos(lat) being 0 (lat ~= 90); France latitudes are safe.
      const cosLat = Math.cos((lat * Math.PI) / 180) || 1
      const lonDegPerKm = 1 / (111.320 * cosLat)
      const dLng = -shiftKm * lonDegPerKm // negative -> move west

      return [lat + dLat, lng + dLng]
    }

    function shiftAndExpandRing(ring) {
      // Compute a simple centroid to push points radially outward from.
      const centroid = ring.reduce(
        (acc, [lat, lng]) => {
          acc.lat += lat
          acc.lng += lng
          return acc
        },
        { lat: 0, lng: 0 }
      )
      const centroidLat = centroid.lat / ring.length
      const centroidLng = centroid.lng / ring.length

      return ring.map(([lat, lng]) => {
        // Apply the global shift first
        const [sLat, sLng] = shiftPoint([lat, lng])

        // push outward by `expandKm` along the vector from centroid
        const dx = sLat - centroidLat
        const dy = sLng - centroidLng
        const dist = Math.hypot(dx, dy)
        if (dist === 0) return [sLat, sLng]

        const latDegPerKm = 1 / 110.574
        const dLatExp = (expandKm * latDegPerKm) * (dx / dist)

        const cosCentroidLat = Math.cos((centroidLat * Math.PI) / 180) || 1
        const lonDegPerKm = 1 / (111.320 * cosCentroidLat)
        const dLngExp = (expandKm * lonDegPerKm) * (dy / dist)

        return [sLat + dLatExp, sLng + dLngExp]
      })
    }

    const holes = getFranceHoles(france).map((ring) => shiftAndExpandRing(ring))

    const rings = [outer].concat(holes)

    const mask = polygon(rings, {
      color: '#000',
      weight: 0,
      fillColor: '#000',
      fillOpacity: 0.6,
      interactive: false,
    })
    mask._umapMaskId = MASK_ID
    mask.addTo(map)
    return mask
  } catch (e) {
    console.error('France mask error', e)
  }
}


export function removeFranceMask(map) {
  // find any layer with our id
  map.eachLayer((layer) => {
    if (layer && layer._umapMaskId === MASK_ID) {
      try {
        map.removeLayer(layer)
      } catch (e) {}
    }
  })
}
