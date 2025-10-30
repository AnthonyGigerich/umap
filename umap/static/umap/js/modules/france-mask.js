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

    const delta = 0.05 // ~5 km
    const holes = getFranceHoles(france).map((ring) =>
      ring.map(([lat, lng]) => [lat + delta, lng + delta])
    )

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
