import { DomUtil } from '../../../vendors/leaflet/leaflet-src.esm.js'
import { translate } from '../i18n.js'
import { uMapAlert as Alert } from '../../components/alerts/alert.js'
import { BaseAjax, SingleMixin } from '../autocomplete.js'

class Autocomplete extends SingleMixin(BaseAjax) {
  handleResults(data) {
    return super.handleResults(data.features)
  }

  createResult(item) {
    const labels = [item.properties.name]
    if (item.properties.county) labels.push(item.properties.county)
    if (item.properties.state) labels.push(item.properties.state)
    if (item.properties.country) labels.push(item.properties.country)
    return super.createResult({
      value: item.properties.osm_id + 3600000000,
      label: labels.join(', '),
    })
  }
}

export class Importer {
  constructor(map, options) {
    this.map = map
    this.name = options.name || 'Datasets'
    this.choices = options?.choices
    this.id = this.name.toLowerCase().replace(/\s+/g, '-')
    this.searchUrl =
      options?.searchUrl || 'https://photon.komoot.io/api?q={q}&layer=county&layer=city&layer=state'
  }

  async open(importer) {
    const container = DomUtil.create('div', 'formbox')
    DomUtil.element({ tagName: 'h3', textContent: this.name, parent: container })

    // --- Dataset selector ---
    const select = DomUtil.create('select', '', container)
    DomUtil.element({ tagName: 'option', parent: select, value: '', textContent: translate('Choose a dataset') })
    for (const dataset of this.choices) {
      const option = DomUtil.create('option', '', select)
      option.value = dataset.url || (dataset.format === 'osm' ? (this.map?.properties?.importers?.overpass?.url || 'https://overpass-api.de/api/interpreter') : '')
      option.textContent = dataset.label
      option.dataset.format = dataset.format || 'geojson'
      // store the dataset data key (slug) so we can call the API using the data identifier
      if (dataset.data) option.dataset.data = dataset.data
      if (dataset.geographic_query) option.dataset.geographic_query = dataset.geographic_query
      else if (dataset.geographicQuery) option.dataset.geographic_query = dataset.geographicQuery
      if (dataset.expression) option.dataset.expression = dataset.expression
    }

    // --- Area autocomplete (for OSM) ---
    const label = DomUtil.element({ tagName: 'label', id: 'area', parent: container })
    DomUtil.element({ tagName: 'span', textContent: translate('Search area'), parent: label })
    this.autocomplete = new Autocomplete(label, {
      url: this.searchUrl,
      placeholder: translate('Type area name (optional)'),
      on_select: (choice) => (this.boundaryChoice = choice),
      on_unselect: () => (this.boundaryChoice = null),
    })
    label.style.display = 'none'

    // --- Overpass-specific controls ---
    const overpassContainer = DomUtil.create('div', 'overpass-form', container)
    overpassContainer.style.display = 'none'
    const exprLabel = DomUtil.element({ tagName: 'label', parent: overpassContainer })
    DomUtil.element({ tagName: 'span', textContent: translate('Expression'), parent: exprLabel })
    const tagsInput = DomUtil.element({ tagName: 'input', parent: exprLabel, type: 'text', name: 'tags', placeholder: 'amenity=drinking_water', readOnly: true })
    tagsInput.style.display = 'block'
    tagsInput.style.width = '100%'
    const geomLabel = DomUtil.element({ tagName: 'label', parent: overpassContainer })
    DomUtil.element({ tagName: 'span', textContent: translate('Geometry mode'), parent: geomLabel })
    const outSelect = DomUtil.element({ tagName: 'select', parent: geomLabel, name: 'out' })
    DomUtil.element({ tagName: 'option', parent: outSelect, value: 'geom', textContent: translate('Default'), selected: true })
    DomUtil.element({ tagName: 'option', parent: outSelect, value: 'center', textContent: translate('Only geometry centers') })

    // --- umap-data filter selector ---
    const geoSelectLabel = DomUtil.element({ tagName: 'label', id: 'geo_select_label', parent: container })
    DomUtil.element({ tagName: 'span', textContent: 'Sélectionne la zone géographique', parent: geoSelectLabel })
    const geoSelect = DomUtil.create('select', '', geoSelectLabel)
    geoSelectLabel.style.display = 'none'

    // Unified change handler
    select.addEventListener('change', async () => {
      const option = select.options[select.selectedIndex]
      const fmt = option && option.dataset ? option.dataset.format : null
      const expr = option && option.dataset ? option.dataset.expression : null

      // reset
      overpassContainer.style.display = 'none'
      label.style.display = 'none'
      tagsInput.value = ''
      geoSelectLabel.style.display = 'none'

      if (fmt === 'osm') {
        overpassContainer.style.display = ''
        tagsInput.style.display = 'block'
        label.style.display = ''
        if (expr) tagsInput.value = expr.replace(/\[out:[^\]]*\];?/i, '')
        return
      }

      if (fmt === 'umap-data') {
        geoSelectLabel.style.display = ''
        geoSelect.innerHTML = ''
        DomUtil.element({ tagName: 'option', parent: geoSelect, value: '', textContent: translate('Choose a filter') })
        try {
          const base = this.map?.properties?.UMAP_DATA_API || ''
    // Prefer a dataset 'data' key (slug) when present; fall back to slugified label
    const labelSlug = option && option.dataset && option.dataset.data ? option.dataset.data : (option ? option.textContent.toLowerCase().replace(/\s+/g, '-') : '')
    const url = `${base}datasets/${labelSlug}/filters`
          const resp = await fetch(url)
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          let data = await resp.json()
          // Some APIs wrap arrays inside a key (filters, results, items)
          if (data && typeof data === 'object' && !Array.isArray(data)) {
            const candidates = ['filters', 'results', 'items', 'data']
            for (const c of candidates) {
              if (Array.isArray(data[c])) {
                data = data[c]
                break
              }
            }
          }
          // Now data should ideally be an array or an object map
          if (Array.isArray(data)) {
            for (const f of data) {
              const opt = DomUtil.create('option', '', geoSelect)
              if (f && typeof f === 'object') {
                opt.value = f.id || f.value || f.label || ''
                opt.textContent = f.label || f.value || f.id || String(f)
              } else {
                opt.value = String(f)
                opt.textContent = String(f)
              }
            }
          } else if (data && typeof data === 'object') {
            // object map: keys -> labels
            for (const k of Object.keys(data)) {
              const opt = DomUtil.create('option', '', geoSelect)
              opt.value = k
              opt.textContent = data[k]
            }
          }
        } catch (err) {
          geoSelectLabel.style.display = 'none'
          console.error('Failed to load umap-data filters', err)
          Alert && Alert.error && Alert.error(translate('Failed to load filters from remote API'))
        }
        return
      }
    })

    // --- Confirm action ---
    const confirm = () => {
      const option = select.options[select.selectedIndex]
      const fmt = option && option.dataset ? option.dataset.format : null
      if (!select.value && fmt !== 'umap-data') return

      importer.layerName = option ? option.textContent : ''

      if (fmt === 'osm') {
        const option2 = select.options[select.selectedIndex]
        let expr = option2 && option2.dataset ? option2.dataset.expression : null
        if (!expr) expr = tagsInput.value || ''
        expr = expr.trim()
        if (!expr) {
          Alert && Alert.error && Alert.error(translate('Expression is empty'))
          return
        }
        expr = expr.replace(/^\s*\[out:[^\]]*\]\s*;?/i, '')
        expr = expr.replace(/;?\s*out\s+[^;]+;?\s*$/i, '')
        const isElementExpr = /^\s*(?:nwr|node|way|relation|\()/i.test(expr)
        if (isElementExpr) {
          let body = expr
          body = body.replace(/^\s*\[out:[^\]]*\]\s*;?/i, '')
          body = body.replace(/;?\s*out\s+[^;]+;?\s*$/i, '')
          if (body.startsWith('(')) {
            const bbox = '{south},{west},{north},{east}'
            body = body.replace(/\b(nwr|node|way|relation)(\[[^\]]*\])?/ig, function (match, el, attrs) {
              return el + (attrs || '') + `(${bbox})`
            })
          } else if (/^\s*(?:nwr|node|way|relation)/i.test(body)) {
            const areaStr = this.boundaryChoice ? `area:${this.boundaryChoice.item.value}` : '{south},{west},{north},{east}'
            body = body.replace(/;?$/,'') + `(${areaStr})`
          }
          const query = `[out:json];${body};out ${outSelect.value};`
          importer.url = `${select.value}?data=${encodeURIComponent(query)}`
          importer.format = 'osm'
          if (this.boundaryChoice) importer.layerName = `${(option ? option.textContent : '')} - ${this.boundaryChoice.item.label}`
        } else {
          const params = { expression: expr, out: outSelect.value, autoConfirm: true }
          if (this.boundaryChoice) params.area = this.boundaryChoice.item.value
          if (typeof importer.openHelper === 'function') importer.openHelper('overpass', params)
          else {
            const area = this.boundaryChoice ? `area:${this.boundaryChoice.item.value}` : '{south},{west},{north},{east}'
            const tags = expr.startsWith('[') ? expr : `[${expr}]`
            const query = `[out:json];nwr${tags}(${area});out ${outSelect.value};`
            importer.url = `${select.value}?data=${encodeURIComponent(query)}`
            importer.format = 'osm'
            if (this.boundaryChoice) importer.layerName = `${(option ? option.textContent : '')} - ${this.boundaryChoice.item.label}`
          }
        }
      } else if (fmt === 'umap-data') {
        const base = this.map?.properties?.UMAP_DATA_API || ''
  const labelSlug = option && option.dataset && option.dataset.data ? option.dataset.data : (option ? option.textContent.toLowerCase().replace(/\s+/g, '-') : '')
  const geographicQuery = option && option.dataset ? (option.dataset.geographic_query || option.dataset.geographicQuery) : 'geographic_query'
        const selectedFilter = geoSelect && geoSelect.value ? geoSelect.value : ''
        if (!selectedFilter) {
          Alert && Alert.error && Alert.error(translate('Please select a geographic filter'))
          return
        }
        const url = `${base}datasets/${labelSlug}?${encodeURIComponent(geographicQuery)}=${encodeURIComponent(selectedFilter)}`
        importer.url = url
        importer.format = 'geojson'
        importer.layerName = (option ? option.textContent : '') + (selectedFilter ? ` - ${selectedFilter}` : '')
      } else {
        importer.url = select.value
        importer.format = fmt
        if (this.boundaryChoice) importer.area = this.boundaryChoice.item.label
      }
    }

    importer.dialog
      .open({ template: container, className: `${this.id} importer dark`, accept: translate('Choose this dataset'), cancel: false })
      .then(confirm)
  }
}
