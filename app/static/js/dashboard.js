// Basemap Layers: Google Maps JavaScript API (Roadmap, Hybrid Satellite, and Terrain with region=IN)
    const map = L.map('map', { zoomControl: true, minZoom: 4, maxZoom: 18 }).setView([22.5, 79.5], 5);
    
    // 1. Google Roadmap (Default clean, crisp vector map with Survey of India boundary)
    const googleRoadmap = L.gridLayer.googleMutant({
      type: 'roadmap',
      maxZoom: 20
    }).addTo(map);

    // 2. Google Satellite / Hybrid (High-res aerial imagery + road overlays)
    const googleHybrid = L.gridLayer.googleMutant({
      type: 'hybrid',
      maxZoom: 20
    });

    // 3. Google Terrain (Natural contours, elevations, and relief shading)
    const googleTerrain = L.gridLayer.googleMutant({
      type: 'terrain',
      maxZoom: 20
    });

    let currentBasemap = 'roadmap';
    function setBasemap(mode) {
      currentBasemap = mode;
      const btnRoadmap = document.getElementById('btnMapRoadmap');
      const btnSatellite = document.getElementById('btnMapSatellite');
      const btnTerrain = document.getElementById('btnMapTerrain');

      if (btnRoadmap) btnRoadmap.className = 'mode-btn ' + (mode === 'roadmap' ? 'active' : '');
      if (btnSatellite) btnSatellite.className = 'mode-btn ' + (mode === 'hybrid' || mode === 'satellite' ? 'active' : '');
      if (btnTerrain) btnTerrain.className = 'mode-btn ' + (mode === 'terrain' ? 'active' : '');

      map.removeLayer(googleRoadmap);
      map.removeLayer(googleHybrid);
      map.removeLayer(googleTerrain);

      if (mode === 'hybrid' || mode === 'satellite') {
        map.addLayer(googleHybrid);
      } else if (mode === 'terrain') {
        map.addLayer(googleTerrain);
      } else {
        map.addLayer(googleRoadmap);
      }
    }

    // State, District, and Pincode Layer Groups
    let stateGeojson = null;
    let districtGeojson = null;
    let stateLayer = null;
    let districtLayer = null;
    let googlePolygonLayer = null;
    let pinDotsLayerGroup = L.layerGroup().addTo(map);
    let heatLayer = null;

    // Helper: Update Polygon Source Badge (Disabled per user request for clean UI)
    function updatePolygonBadge(source, message) {}

    // State Variables
    let currentMonth = 'Jun-26';
    let currentHorizon = 'Jun-26';
    let selectedState = null;
    let selectedDistrict = null;
    let selectedPincode = null;
    let stateSummaries = {};
    let currentSchemes = [];
    let currentTrends = [];
    let currentSchemeRotation = [];
    let currentSchemeTab = 'gross';
    let currentHeatMode = 'crisp';
    let currentHeatOpacity = 0.85;

    function showLoader(show) {
      document.getElementById('loader').style.display = show ? 'block' : 'none';
    }

    // Initialize application
    window.addEventListener('DOMContentLoaded', async () => {
      showLoader(true);
      try {
        // 1. Fetch Month list
        const mRes = await fetch('/api/months');
        const mData = await mRes.json();
        if (mData.months && mData.months.length) {
          const sel = document.getElementById('monthSelect');
          sel.innerHTML = mData.months.map(m => `<option value="${m}" ${m===mData.default?'selected':''}>${m}</option>`).join('');
          currentMonth = mData.default;
        }

        // 2. Fetch GeoJSONs
        const [sGeo, dGeo] = await Promise.all([
          fetch('/api/geojson/states').then(r => r.json()),
          fetch('/api/geojson/districts').then(r => r.json())
        ]);
        stateGeojson = sGeo;
        districtGeojson = dGeo;

        // 3. Load National & Map Data
        await loadMonthData();

        // Dynamically adjust heatmap radius and dot visibility on zoom
        map.on('zoomend', () => {
          renderHeatAndPins();
        });
      } catch (e) {
        console.error("Initialization error:", e);
      } finally {
        showLoader(false);
      }
    });

    async function onMonthChange() {
      currentMonth = document.getElementById('monthSelect').value;
      await loadMonthData();
    }

    async function loadMonthData() {
      showLoader(true);
      try {
        // Fetch National Summary
        const natRes = await fetch(`/api/national_summary?month=${currentMonth}`);
        const natData = await natRes.json();
        renderTopTicker(natData.summary);

        // Fetch State Summaries for choropleth tooltips
        const stRes = await fetch(`/api/state_summary?month=${currentMonth}`);
        const stData = await stRes.json();
        stateSummaries = stData.states || {};

        // Render Layers
        renderStatePolygons();
        await renderHeatAndPins();

        // If a specific entity is selected, reload its details; otherwise show National
        if (selectedPincode) {
          await loadPincodeDetails(selectedPincode);
        } else if (selectedDistrict) {
          await loadDistrictDetails(selectedDistrict, selectedState);
        } else if (selectedState) {
          await loadStateDetails(selectedState);
        } else {
          renderSidebarNational(natData.summary, natData.schemes);
        }
      } catch (e) {
        console.error("Error loading month data:", e);
      } finally {
        showLoader(false);
      }
    }

    function renderTopTicker(s) {
      if (!s) return;
      document.getElementById('topNatAum').innerText = `₹${(s.nat_aum/100000).toFixed(2)} L Cr`;
      document.getElementById('topNatGross').innerText = `₹${Math.round(s.nat_gross).toLocaleString()} Cr`;

      const gross = s.nat_gross || 0;
      const sip = s.nat_sip || 0;
      const stp = s.nat_stp || 0;
      const lumpsum = s.nat_lump !== undefined ? s.nat_lump : Math.max(0, (s.nat_sales || 0) - sip);
      const breakdownEl = document.getElementById('topNatInflowBreakdown');
      if (breakdownEl) {
        breakdownEl.innerText = `Lump: ₹${Math.round(lumpsum).toLocaleString()} Cr | SIP: ₹${Math.round(sip).toLocaleString()} Cr | STP: ₹${Math.round(stp).toLocaleString()} Cr`;
      }

      document.getElementById('topNatOutflows').innerText = `₹${Math.round(s.nat_outflow).toLocaleString()} Cr`;
      const netSign = s.nat_net >= 0 ? '+' : '';
      document.getElementById('topNatNet').innerText = `${netSign}₹${Math.round(s.nat_net).toLocaleString()} Cr`;
      document.getElementById('topNatSip').innerText = `₹${Math.round(s.nat_sip).toLocaleString()} Cr/mo`;
      document.getElementById('topNatMfds').innerText = (s.nat_mfds_footprint || 0).toLocaleString();
    }

    function renderStatePolygons() {
      if (stateLayer) map.removeLayer(stateLayer);

      stateLayer = L.geoJson(stateGeojson, {
        style: function(feature) {
          const sName = feature.properties.state_name;
          const isSelected = (selectedState === sName);
          return {
            fillColor: isSelected ? '#ea4335' : 'transparent',
            weight: isSelected ? 2.5 : 0, // Zero lines by default so Google's clean native borders show!
            color: isSelected ? '#ea4335' : 'transparent',
            dashArray: isSelected ? '4, 4' : '',
            fillOpacity: isSelected ? 0.05 : 0
          };
        },
        onEachFeature: function(feature, layer) {
          const sName = feature.properties.state_name;
          const sObj = stateSummaries[sName];

          if (sObj) {
            layer.bindTooltip(`
              <div style="font-family:'JetBrains Mono'; font-size:11px;">
                <b style="color:#ea4335;font-size:12px;">${sName}</b><br/>
                Gross: <b>₹${sObj.gross_cr.toLocaleString()} Cr</b><br/>
                Net: <b>${sObj.net_cr >= 0 ? '+' : ''}₹${sObj.net_cr.toLocaleString()} Cr</b><br/>
                SIP: <b>₹${sObj.sip_cr.toLocaleString()} Cr</b><br/>
                <span style="color:#64748b;font-size:10px;">Active MFDs: ${sObj.active_mfds}</span>
              </div>
            `, { sticky: true });
          }

          layer.on('mouseover', function(e) {
            if (selectedState !== sName) {
              layer.setStyle({
                weight: 2,
                color: '#ea4335',
                dashArray: '4, 4',
                fillColor: '#ea4335',
                fillOpacity: 0.04
              });
            }
          });

          layer.on('mouseout', function(e) {
            if (selectedState !== sName) {
              layer.setStyle({
                weight: 0,
                color: 'transparent',
                fillOpacity: 0
              });
            }
          });

          layer.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            drillDownToState(sName, layer.getBounds());
          });
        }
      }).addTo(map);
    }

    async function drillDownToState(stateName, bounds) {
      selectedState = stateName;
      selectedDistrict = null;
      selectedPincode = null;
      document.getElementById('backBtn').style.display = 'block';
      document.getElementById('breadcrumbText').innerText = `All India > ${stateName}`;

      if (bounds) map.fitBounds(bounds, { padding: [20, 20] });
      renderStatePolygons();
      renderDistrictPolygons();
      await renderHeatAndPins();
      await loadStateDetails(stateName);
    }

    function renderDistrictPolygons() {
      if (districtLayer) map.removeLayer(districtLayer);
      if (!selectedState) return;

      districtLayer = L.geoJson(districtGeojson, {
        filter: function(feature) {
          const st = feature.properties.state || '';
          return st.toUpperCase().includes(selectedState.toUpperCase()) || selectedState.toUpperCase().includes(st.toUpperCase());
        },
        style: function(feature) {
          const dName = feature.properties.district || '';
          const isSelected = (selectedDistrict === dName) || 
            (selectedDistrict === 'Mumbai' && (dName === 'Mumbai' || dName === 'Mumbai Suburban' || dName === 'Mumbai City' || dName === 'Greater Bombay'));
          return {
            fillColor: isSelected ? '#ea4335' : 'transparent',
            weight: isSelected ? 2.5 : 0.8,
            color: isSelected ? '#ea4335' : 'rgba(100, 116, 139, 0.35)',
            dashArray: isSelected ? '4, 4' : '2, 3',
            fillOpacity: isSelected ? 0.08 : 0
          };
        },
        onEachFeature: function(feature, layer) {
          const dName = feature.properties.district || '';
          const displayName = (dName === 'Mumbai Suburban' || dName === 'Mumbai City' || dName === 'Greater Bombay') ? 'Mumbai' : dName;
          layer.bindTooltip(`
            <div style="font-family:'JetBrains Mono'; font-size:11px;">
              <b style="color:#ea4335;font-size:12px;">🏙️ ${displayName}</b><br/>
              <span style="color:#64748b;font-size:10px;">Click to inspect district micro-market</span>
            </div>
          `, { sticky: true });

          layer.on('mouseover', function(e) {
            const isSel = (selectedDistrict === dName) || 
              (selectedDistrict === 'Mumbai' && (dName === 'Mumbai' || dName === 'Mumbai Suburban' || dName === 'Mumbai City' || dName === 'Greater Bombay'));
            if (!isSel) {
              layer.setStyle({
                weight: 2,
                color: '#ea4335',
                dashArray: '4, 4',
                fillOpacity: 0.04
              });
            }
          });

          layer.on('mouseout', function(e) {
            const isSel = (selectedDistrict === dName) || 
              (selectedDistrict === 'Mumbai' && (dName === 'Mumbai' || dName === 'Mumbai Suburban' || dName === 'Mumbai City' || dName === 'Greater Bombay'));
            if (!isSel) {
              layer.setStyle({
                weight: 0.8,
                color: 'rgba(100, 116, 139, 0.35)',
                dashArray: '2, 3',
                fillOpacity: 0
              });
            }
          });

          layer.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            const targetDist = (dName === 'Mumbai Suburban' || dName === 'Mumbai City' || dName === 'Greater Bombay') ? 'Mumbai' : dName;
            drillDownToDistrict(targetDist, selectedState, layer.getBounds());
          });
        }
      }).addTo(map);
    }

    async function drillDownToDistrict(districtName, stateName, bounds) {
      if (districtName === 'Mumbai Suburban' || districtName === 'Mumbai City' || districtName === 'Greater Bombay') {
        districtName = 'Mumbai';
      }
      selectedDistrict = districtName;
      selectedPincode = null;
      document.getElementById('breadcrumbText').innerText = `All India > ${stateName} > ${districtName}`;
      updatePolygonBadge('local_dataset');
      if (googlePolygonLayer) {
        map.removeLayer(googlePolygonLayer);
        googlePolygonLayer = null;
      }
      if (bounds) map.fitBounds(bounds, { padding: [20, 20] });

      renderDistrictPolygons();
      await renderHeatAndPins();
      await loadDistrictDetails(districtName, stateName);
    }

    async function renderHeatAndPins() {
      let url = `/api/map_summary?month=${currentMonth}`;
      if (selectedState) url += `&state=${encodeURIComponent(selectedState)}`;
      if (selectedDistrict) url += `&district=${encodeURIComponent(selectedDistrict)}`;

      const res = await fetch(url);
      const data = await res.json();
      const pincodes = data.pincodes || [];

      // 1. Precision Calibrated Doppler Heatmap (Crisp with Vibrant Crimson Red & Violet Hotspots)
      if (heatLayer) map.removeLayer(heatLayer);
      if (currentHeatMode !== 'off') {
        const zoom = map.getZoom();
        const vals = pincodes.map(p => p[7] || 0).filter(v => v > 0).sort((a, b) => a - b);
        const p98 = vals[Math.floor(vals.length * 0.98)] || vals[vals.length - 1] || 1;
        const powerExp = (currentHeatMode === 'crisp') ? 0.54 : 0.40;

        const heatPoints = [];
        pincodes.forEach(p => {
          const lat = p[1], lon = p[2], gross = p[7] || 0;
          if (lat === 0 || lon === 0 || gross <= 0) return;

          const intensity = Math.min(Math.pow(gross / p98, powerExp), 1.0);
          if (currentHeatMode === 'crisp' && intensity < 0.10) return; // Cut out faint background noise

          heatPoints.push([lat, lon, intensity]);
        });

        // Zoom-dependent tight radius & blur: sharp, focused, zero diffuse smoke
        let radius = 13;
        let blur = 7;
        if (currentHeatMode === 'crisp') {
          if (zoom >= 12) { radius = 8; blur = 4; }
          else if (zoom >= 9) { radius = 11; blur = 5; }
          else if (zoom >= 7) { radius = 13; blur = 7; }
          else { radius = 14; blur = 8; }
        } else {
          if (zoom >= 12) { radius = 14; blur = 9; }
          else if (zoom >= 9) { radius = 18; blur = 12; }
          else if (zoom >= 7) { radius = 22; blur = 15; }
          else { radius = 26; blur = 18; }
        }

        const crispRadarGradient = {
          0.18: 'rgba(2, 132, 199, 0.85)',
          0.38: '#059669',                 
          0.60: '#d97706',                 
          0.78: '#ea580c',                 
          0.88: '#dc2626', // Radiant Crimson Red
          1.00: '#7c3aed'  // Electric Violet Hotspot Core
        };

        const softRadarGradient = {
          0.10: 'rgba(2, 132, 199, 0.65)',
          0.30: '#0284c7',                 
          0.50: '#16a34a',                 
          0.70: '#eab308',                 
          0.85: '#dc2626',                 
          1.00: '#7e22ce'                  
        };

        heatLayer = L.heatLayer(heatPoints, {
          radius: radius,
          blur: blur,
          maxZoom: 14,
          max: 0.85, // Lower max threshold ensures top business hubs glow in rich Crimson Red
          minOpacity: Math.max(0.1, currentHeatOpacity * 0.4),
          gradient: (currentHeatMode === 'crisp') ? crispRadarGradient : softRadarGradient
        }).addTo(map);

        const canvas = document.querySelector('.leaflet-heatmap-layer');
        if (canvas) canvas.style.opacity = currentHeatOpacity;
      }

      // 2. Pincode Dots
      pinDotsLayerGroup.clearLayers();
      const zoom = map.getZoom();

      // Show pincode dots if zoomed in or state/district selected
      if (selectedState || selectedDistrict || zoom >= 9) {
        pincodes.forEach(p => {
          const pin = p[0], lat = p[1], lon = p[2], city = p[3], dist = p[4], st = p[5];
          const aum = p[6], gross = p[7], outflow = p[8], net = p[9], sip = p[10], mfds = p[13];

          const isSelected = (selectedPincode === pin);
          const dotRadius = isSelected ? 7 : (zoom >= 12 ? 5 : (zoom >= 9 ? 3.5 : 2.5));
          const dotColor = isSelected ? '#d97706' : '#2563eb';

          const dot = L.circleMarker([lat, lon], {
            radius: dotRadius,
            fillColor: dotColor,
            color: '#ffffff',
            weight: isSelected ? 2.5 : 1.0,
            opacity: 1,
            fillOpacity: isSelected ? 1.0 : 0.85
          });

          dot.bindTooltip(`
            <div style="font-family:'JetBrains Mono'; font-size:11px;">
              <b style="color:#2563eb;font-size:12px;">📌 PIN ${pin}</b><br/>
              <span style="color:#0f172a;font-size:10px;">${city} (${dist})</span><br/>
              Gross Inflow: <b>₹${gross.toFixed(2)} Cr</b><br/>
              Net Retained: <b>${net>=0?'+':''}₹${net.toFixed(2)} Cr</b><br/>
              Monthly SIP: <b>₹${sip.toFixed(2)} Cr</b><br/>
              <span style="color:#64748b;font-size:9px;">Active MFDs: ${mfds}</span>
            </div>
          `, { sticky: true });

          dot.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selectPincode(pin, [lat, lon]);
          });

          pinDotsLayerGroup.addLayer(dot);
        });
      }
    }

    async function selectPincode(pin, coords) {
      selectedPincode = pin;
      if (coords) map.setView(coords, Math.max(map.getZoom(), 12));
      document.getElementById('breadcrumbText').innerText = `All India > ${selectedState || 'State'} > ${selectedDistrict || 'District'} > PIN ${pin}`;
      await loadPincodeDetails(pin);
    }

    async function loadPincodeDetails(pin) {
      showLoader(true);
      try {
        const res = await fetch(`/api/pincode_details?month=${currentMonth}&pincode=${pin}`);
        const data = await res.json();
        if (data.summary) {
          renderSidebarPincode(data.summary, data.schemes);
        }
      } catch (e) {
        console.error("Error loading pin details:", e);
      } finally {
        showLoader(false);
      }
    }

    async function loadDistrictDetails(district, state) {
      showLoader(true);
      try {
        const res = await fetch(`/api/district_details?month=${currentMonth}&district=${encodeURIComponent(district)}&state=${encodeURIComponent(state)}`);
        const data = await res.json();
        if (data.summary) {
          renderSidebarDistrict(data.summary, data.schemes);
        }
      } catch (e) {
        console.error("Error loading district details:", e);
      } finally {
        showLoader(false);
      }
    }

    async function loadStateDetails(state) {
      showLoader(true);
      try {
        const res = await fetch(`/api/state_details?month=${currentMonth}&state=${encodeURIComponent(state)}`);
        const data = await res.json();
        if (data.summary) {
          renderSidebarState(data.summary, data.schemes);
        }
      } catch (e) {
        console.error("Error loading state details:", e);
      } finally {
        showLoader(false);
      }
    }

    function renderSidebarNational(sum, schemes) {
      document.getElementById('sideTierTag').innerText = "National Universe";
      document.getElementById('sideTitle').innerText = "All India Front";
      document.getElementById('sideSubtitle').innerText = "Verified Independent MFD & RIA Telemetry";

      const natLump = sum.nat_lump !== undefined ? sum.nat_lump : Math.max(0, (sum.nat_sales || 0) - (sum.nat_sip || 0));
      renderMetricsToSidebar(
        sum.nat_net || 0, sum.nat_gross || 0, sum.nat_outflow || 0,
        sum.nat_sip || 0, sum.nat_stp || 0, sum.nat_sip_cnt || 0, sum.avg_sip_ticket || 0,
        sum.nat_aum || 0, sum.nat_mfds_footprint || 0, schemes, natLump
      );
    }

    function renderSidebarState(sum, schemes) {
      document.getElementById('sideTierTag').innerText = "State Regional Tier";
      document.getElementById('sideTitle').innerText = sum.state;
      document.getElementById('sideSubtitle').innerText = `${(sum.pincodes_count || 0).toLocaleString()} Active Postal Pincodes`;

      const stateLump = sum.total_lumpsum_cr !== undefined ? sum.total_lumpsum_cr : Math.max(0, (sum.total_sales_cr || 0) - (sum.total_sip_cr || 0));
      renderMetricsToSidebar(
        sum.total_net_added_cr || 0, sum.total_gross_cr || 0, sum.total_redemptions_cr || 0,
        sum.total_sip_cr || 0, sum.total_stp_cr || 0, sum.total_sip_count || 0, sum.avg_sip_ticket_inr || 0,
        sum.total_aum_cr || 0, sum.active_mfds || 0, schemes, stateLump
      );
    }

    function renderSidebarDistrict(sum, schemes) {
      document.getElementById('sideTierTag').innerText = "District Market Tier";
      let displayName = selectedDistrict || sum.district || 'District';
      if (displayName === 'Greater Bombay' || displayName === 'Mumbai Suburban' || displayName === 'Mumbai City') {
        displayName = 'Mumbai';
      }
      document.getElementById('sideTitle').innerText = displayName;
      document.getElementById('sideSubtitle').innerText = `District in ${sum.state} (${sum.pincodes_count || 0} PINs)`;

      const distLump = sum.total_lumpsum_cr !== undefined ? sum.total_lumpsum_cr : Math.max(0, (sum.total_sales_cr || 0) - (sum.total_sip_cr || 0));
      renderMetricsToSidebar(
        sum.total_net_added_cr || 0, sum.total_gross_cr || 0, sum.total_redemptions_cr || 0,
        sum.total_sip_cr || 0, sum.total_stp_cr || 0, sum.total_sip_count || 0, sum.avg_sip_ticket_inr || 0,
        sum.total_aum_cr || 0, sum.total_mfds_footprint || 0, schemes, distLump
      );
    }

    function renderSidebarPincode(sum, schemes) {
      document.getElementById('sideTierTag').innerText = "Micro-Market Pincode";
      document.getElementById('sideTitle').innerText = `PIN ${sum.pincode}`;
      let distName = sum.district || 'District';
      if (distName === 'Greater Bombay' || distName === 'Mumbai Suburban' || distName === 'Mumbai City') {
        distName = 'Mumbai';
      }
      document.getElementById('sideSubtitle').innerText = `${sum.city || 'City'}, ${sum.state} (${distName})`;

      const pinLump = sum.total_lumpsum_cr !== undefined ? sum.total_lumpsum_cr : Math.max(0, (sum.total_sales_cr || 0) - (sum.total_sip_cr || 0));
      renderMetricsToSidebar(
        sum.total_net_added_cr || 0, sum.total_gross_cr || 0, sum.total_redemptions_cr || 0,
        sum.total_sip_cr || 0, sum.total_stp_cr || 0, sum.total_sip_count || 0, sum.avg_sip_ticket_inr || 0,
        sum.total_aum_cr || 0, sum.active_mfds || 0, schemes, pinLump
      );
    }

    function renderMetricsToSidebar(net, gross, outflow, sip, stp, sipCount, avgTicket, aum, mfds, schemes, lumpsum) {
      currentSchemes = schemes || [];

      // Hero Card Net Added
      const netSign = net >= 0 ? '+' : '';
      document.getElementById('heroLabel').innerText = "Net New Business Retained in Month";
      document.getElementById('sideNet').innerText = `${netSign}₹${net.toFixed(2)} Cr`;
      document.getElementById('sideNet').style.color = net >= 0 ? '#166534' : '#b91c1c';
      document.getElementById('sideGross').innerText = `Gross Inflow: ₹${gross.toFixed(2)} Cr`;
      document.getElementById('sideOutflow').innerText = `Total Outflow: ₹${outflow.toFixed(2)} Cr`;

      const retPct = gross > 0 ? ((net / gross) * 100.0) : 0;
      document.getElementById('sideRetention').innerText = `Retention: ${retPct.toFixed(1)}%`;

      // Inflow Sourcing Breakdown: Lump | SIP | STP
      const lump = (lumpsum !== undefined && lumpsum !== null) ? lumpsum : Math.max(0, gross - sip - stp);
      const inflowEl = document.getElementById('sideInflowBreakdown');
      if (inflowEl) {
        inflowEl.innerHTML = `<span>Inflows: <b>Lump: ₹${lump.toFixed(1)} Cr</b> | <b>SIP: ₹${sip.toFixed(1)} Cr</b> | <b>STP: ₹${stp.toFixed(1)} Cr</b></span>`;
      }

      // 4 Tiles
      document.getElementById('sideSip').innerText = `₹${sip.toFixed(2)} Cr`;
      document.getElementById('sideSipCount').innerText = `${Math.round(sipCount).toLocaleString()} Debits`;
      document.getElementById('sideAvgTicket').innerText = `₹${Math.round(avgTicket).toLocaleString()}`;
      document.getElementById('sideAum').innerText = aum > 10000 ? `₹${(aum/1000).toFixed(1)}k Cr` : `₹${Math.round(aum).toLocaleString()} Cr`;
      document.getElementById('sideMfds').innerText = `${(mfds || 0).toLocaleString()} MFDs`;

      // Asset Class Mix Calculation
      calculateAndRenderAssetMix(currentSchemes);

      // Render Schemes
      renderSchemes();
    }

    function calculateAndRenderAssetMix(schemes) {
      let eq = 0, hy = 0, db = 0, lq = 0, pa = 0, tot = 0;
      schemes.forEach(s => {
        let v = 0;
        if (currentSchemeTab === 'gross') v = s.gross_inflows_cr || 0;
        else if (currentSchemeTab === 'sip') v = s.active_sip_cr || 0;
        else v = s.closing_aum_cr || 0;

        tot += v;
        const ac = (s.asset_class || '').toUpperCase();
        if (ac.includes('EQUITY')) eq += v;
        else if (ac.includes('HYBRID')) hy += v;
        else if (ac.includes('DEBT')) db += v;
        else if (ac.includes('LIQUID')) lq += v;
        else if (ac.includes('PASSIVE')) pa += v;
      });

      if (tot > 0) {
        const eqP = Math.round((eq / tot) * 100);
        const hyP = Math.round((hy / tot) * 100);
        const paP = Math.round((pa / tot) * 100);
        const dbP = Math.round((db / tot) * 100);
        const lqP = Math.max(0, 100 - eqP - hyP - paP - dbP);

        document.getElementById('barEq').style.width = `${eqP}%`;
        document.getElementById('barHy').style.width = `${hyP}%`;
        document.getElementById('barPa').style.width = `${paP}%`;
        document.getElementById('barDb').style.width = `${dbP}%`;
        document.getElementById('barLq').style.width = `${lqP}%`;

        document.getElementById('mixDetail').innerText = `Equity: ${eqP}% | Hybrid: ${hyP}% | Debt: ${dbP}% | Liquid: ${lqP}% | Passive: ${paP}%`;
      }
    }

    function setSchemeTab(tab) {
      currentSchemeTab = tab;
      document.getElementById('tabGross').className = 't-btn ' + (tab === 'gross' ? 'active' : '');
      document.getElementById('tabSip').className = 't-btn ' + (tab === 'sip' ? 'active' : '');
      document.getElementById('tabAum').className = 't-btn ' + (tab === 'aum' ? 'active' : '');
      calculateAndRenderAssetMix(currentSchemes);
      renderSchemes();
    }

    function renderSchemes() {
      const cont = document.getElementById('schemeContainer');
      let sorted = [...currentSchemes];
      if (currentSchemeTab === 'gross') sorted.sort((a, b) => b.gross_inflows_cr - a.gross_inflows_cr);
      else if (currentSchemeTab === 'sip') sorted.sort((a, b) => b.active_sip_cr - a.active_sip_cr);
      else sorted.sort((a, b) => b.closing_aum_cr - a.closing_aum_cr);

      cont.innerHTML = sorted.slice(0, 10).map((s, idx) => {
        let valStr = '';
        let subStr = '';
        if (currentSchemeTab === 'gross') {
          const netSign = s.net_added_cr >= 0 ? '+' : '-';
          valStr = `₹${s.gross_inflows_cr.toFixed(2)} Cr`;
          subStr = `Net: ${netSign}₹${Math.abs(s.net_added_cr).toFixed(2)} Cr | ${s.active_mfds.toLocaleString()} MFDs`;
        } else if (currentSchemeTab === 'sip') {
          valStr = s.active_sip_cr >= 1 ? `₹${s.active_sip_cr.toFixed(2)} Cr` : `₹${(s.active_sip_cr * 100).toFixed(1)} L`;
          subStr = `${(s.active_sip_count || 0).toLocaleString()} debits (₹${Math.round(s.avg_sip_ticket_inr || 0)})`;
        } else {
          valStr = `₹${s.closing_aum_cr.toFixed(2)} Cr`;
          subStr = `${s.asset_class} | ${s.active_mfds} MFDs`;
        }

        return `
          <div class="scheme-item">
            <div>
              <div class="s-name">${idx + 1}. ${s.scheme_type}</div>
              <div class="s-cat">${s.asset_class}</div>
            </div>
            <div>
              <div class="s-val">${valStr}</div>
              <div class="s-sub">${subStr}</div>
            </div>
          </div>
        `;
      }).join('');
    }

    function setHeatMode(mode) {
      currentHeatMode = mode;
      document.getElementById('btnCrisp').className = 'mode-btn ' + (mode === 'crisp' ? 'active' : '');
      document.getElementById('btnSoft').className = 'mode-btn ' + (mode === 'soft' ? 'active' : '');
      document.getElementById('btnOff').className = 'mode-btn ' + (mode === 'off' ? 'active' : '');
      renderHeatAndPins();
    }

    function setHeatOpacity(val) {
      currentHeatOpacity = parseFloat(val);
      const canvas = document.querySelector('.leaflet-heatmap-layer');
      if (canvas) canvas.style.opacity = currentHeatOpacity;
    }

    function resetToNational() {
      selectedState = null;
      selectedDistrict = null;
      selectedPincode = null;
      document.getElementById('backBtn').style.display = 'none';
      document.getElementById('breadcrumbText').innerText = "All India Front";
      updatePolygonBadge(null);
      map.setView([22.5, 79.5], 5);
      renderStatePolygons();
      if (districtLayer) map.removeLayer(districtLayer);
      if (googlePolygonLayer) {
        map.removeLayer(googlePolygonLayer);
        googlePolygonLayer = null;
      }
      renderHeatAndPins();
      loadMonthData();
    }

    // =========================================================================
    // SMART BOUNDARY ENGINE: GOOGLE EXACT POLYGON VS SQUARE BOUNDARY DETECTION
    // =========================================================================

    // 1. Detect whether a geometry or coordinate set represents a square/rectangular box
    function isSquareOrBoundingBox(geom) {
      if (!geom) return true;

      // Google LatLngBounds instance
      if (typeof geom.getNorthEast === 'function' && typeof geom.getSouthWest === 'function') {
        return true; // Any LatLngBounds is inherently a rectangular bounding box / square
      }

      let points = [];
      if (Array.isArray(geom)) {
        if (Array.isArray(geom[0]) && Array.isArray(geom[0][0])) {
          points = geom[0]; // outer ring
        } else if (Array.isArray(geom[0])) {
          points = geom;
        }
      } else if (geom.coordinates && Array.isArray(geom.coordinates)) {
        let c = geom.coordinates;
        if (Array.isArray(c[0]) && Array.isArray(c[0][0])) c = c[0];
        points = c;
      } else if (typeof geom.getPath === 'function') {
        const path = geom.getPath();
        for (let i = 0; i < path.getLength(); i++) {
          const pt = path.getAt(i);
          points.push([pt.lat(), pt.lng()]);
        }
      }

      if (!points || points.length === 0) return true;

      // Check vertex count and axis-alignment
      if (points.length <= 5) {
        const lats = new Set();
        const lngs = new Set();
        for (const pt of points) {
          let lat = null, lng = null;
          if (typeof pt.lat === 'function') {
            lat = pt.lat();
            lng = pt.lng();
          } else if (Array.isArray(pt)) {
            lat = pt[1];
            lng = pt[0];
          } else if (pt && pt.lat !== undefined && pt.lng !== undefined) {
            lat = pt.lat;
            lng = pt.lng;
          }
          if (lat !== null && lng !== null) {
            lats.add(Math.round(lat * 10000) / 10000);
            lngs.add(Math.round(lng * 10000) / 10000);
          }
        }
        if (lats.size <= 2 && lngs.size <= 2) {
          return true; // Exact axis-aligned rectangle / square
        }
        return true; // Bounding box quad
      }

      // > 5 vertices with natural geographic variations = exact irregular polygon
      return false;
    }

    // 2. Query Google Geocoding API
    function queryGoogleGeocode(address) {
      return new Promise((resolve) => {
        if (!window.google || !google.maps || !google.maps.Geocoder) {
          return resolve(null);
        }
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address: address, componentRestrictions: { country: 'IN' } }, (results, status) => {
          if (status === 'OK' && results && results.length > 0) {
            resolve(results[0]);
          } else {
            resolve(null);
          }
        });
      });
    }

    // 3. Extract exact polygon if Google provides one
    function extractGoogleExactPolygon(gRes) {
      if (!gRes || !gRes.geometry) return null;
      let candidate = null;
      if (gRes.geometry.polygon) candidate = gRes.geometry.polygon;
      else if (gRes.geometry.coordinates) candidate = gRes.geometry.coordinates;
      else if (gRes.geometry.geojson) candidate = gRes.geometry.geojson;
      else if (gRes.geometry.paths) candidate = gRes.geometry.paths;

      if (candidate && !isSquareOrBoundingBox(candidate)) {
        return candidate;
      }
      return null;
    }

    // 4. Match query / Google address components to verified local 2024 LGD dataset
    function findMatchedDistrict(qLower, gRes) {
      if (!districtGeojson || !districtGeojson.features) return null;

      const candidates = [qLower];
      if (gRes && gRes.address_components) {
        for (const c of gRes.address_components) {
          candidates.push(c.long_name.toLowerCase());
          candidates.push(c.short_name.toLowerCase());
        }
      }

      const isMumbaiQuery = candidates.some(c => 
        c.includes('mumbai') || c.includes('bombay') || c.includes('bandra') || 
        c.includes('andheri') || c.includes('colaba') || c.includes('dadar') || 
        c.includes('borivali') || c.includes('kurla') || c.includes('worli')
      );

      for (const f of districtGeojson.features) {
        const d = (f.properties.district || '').toLowerCase();
        if (isMumbaiQuery && d.includes('mumbai')) {
          return {
            district: f.properties.district,
            state: f.properties.state,
            feature: f
          };
        }
        for (const c of candidates) {
          if (d === c || (c.length > 3 && (d.includes(c) || c.includes(d)))) {
            return {
              district: f.properties.district,
              state: f.properties.state,
              feature: f
            };
          }
        }
      }
      return null;
    }

    async function searchPincode() {
      const query = document.getElementById('searchInput').value.trim();
      if (!query) return;

      // 1. If 6-digit postal PIN
      if (query.length === 6 && !isNaN(query)) {
        showLoader(true);
        try {
          const res = await fetch(`/api/pincode_details?month=${currentMonth}&pincode=${query}`);
          const data = await res.json();
          if (data.summary) {
            selectedPincode = query;
            selectedState = data.summary.state;
            let d = data.summary.district || 'District';
            if (d === 'Greater Bombay' || d === 'Mumbai Suburban' || d === 'Mumbai City') {
              d = 'Mumbai';
            }
            selectedDistrict = d;
            document.getElementById('backBtn').style.display = 'block';
            document.getElementById('breadcrumbText').innerText = `All India > ${selectedState} > ${selectedDistrict} > PIN ${query}`;
            updatePolygonBadge('local_dataset');

            if (googlePolygonLayer) {
              map.removeLayer(googlePolygonLayer);
              googlePolygonLayer = null;
            }

            if (data.summary.lat && data.summary.lon) {
              map.setView([data.summary.lat, data.summary.lon], 12);
            }
            renderStatePolygons();
            renderDistrictPolygons();
            await renderHeatAndPins();
            renderSidebarPincode(data.summary, data.schemes);
          } else {
            alert(`PIN ${query} not found in verified database for ${currentMonth}.`);
          }
        } catch (e) {
          console.error("Search error:", e);
        } finally {
          showLoader(false);
        }
        return;
      }

      // 2. City / District / Area Name: Smart Check
      // RULE: If Google has exact polygon shape -> show it!
      //       If Google is about to show square -> check our dataset and show our polygon!
      showLoader(true);
      try {
        const qLower = query.toLowerCase();

        // Query Google Geocoding first
        const gRes = await queryGoogleGeocode(query);
        const googleExactPoly = extractGoogleExactPolygon(gRes);

        // CASE A: Google has an exact irregular polygon shape!
        if (googleExactPoly) {
          console.log("[Smart Boundary Engine] Google provided exact polygon shape:", googleExactPoly);
          if (googlePolygonLayer) map.removeLayer(googlePolygonLayer);
          googlePolygonLayer = L.geoJson(googleExactPoly, {
            style: {
              fillColor: '#ea4335',
              weight: 2.5,
              color: '#ea4335',
              dashArray: '4, 4',
              fillOpacity: 0.08
            }
          }).addTo(map);

          updatePolygonBadge('google_exact', gRes.formatted_address || query);
          map.fitBounds(googlePolygonLayer.getBounds(), { padding: [25, 25] });
          document.getElementById('backBtn').style.display = 'block';
          document.getElementById('breadcrumbText').innerText = `All India > ${gRes.formatted_address || query}`;
          
          const matchedD = findMatchedDistrict(qLower, gRes);
          if (matchedD) {
            let d = matchedD.district;
            if (d === 'Greater Bombay' || d === 'Mumbai Suburban' || d === 'Mumbai City') {
              d = 'Mumbai';
            }
            selectedDistrict = d;
            selectedState = matchedD.state;
            await renderHeatAndPins();
            await loadDistrictDetails(d, matchedD.state);
          }
          return;
        }

        // CASE B: Google does not have an exact polygon, or only provides a square/bounding box
        if (gRes && (gRes.geometry.bounds || gRes.geometry.viewport)) {
          console.log(`[Smart Boundary Engine] Google only returned bounding box/square for "${query}". Discarding square! Overriding with verified local 2024 dataset polygon.`);
        }

        // Search in verified local 2024 LGD dataset
        const matched = findMatchedDistrict(qLower, gRes);
        if (matched) {
          if (googlePolygonLayer) {
            map.removeLayer(googlePolygonLayer);
            googlePolygonLayer = null;
          }

          selectedState = matched.state;
          let distName = matched.district;
          if (distName === 'Greater Bombay' || distName === 'Mumbai Suburban' || distName === 'Mumbai City') {
            distName = 'Mumbai';
          }
          selectedDistrict = distName;
          selectedPincode = null;
          document.getElementById('backBtn').style.display = 'block';
          document.getElementById('breadcrumbText').innerText = `All India > ${matched.state} > ${distName}`;
          updatePolygonBadge('local_dataset');

          const bounds = L.geoJson(matched.feature).getBounds();
          map.fitBounds(bounds, { padding: [25, 25] });

          renderStatePolygons();
          renderDistrictPolygons();
          await renderHeatAndPins();
          await loadDistrictDetails(distName, matched.state);
          return;
        }

        // Search state in stateGeojson
        if (stateGeojson && stateGeojson.features) {
          for (const f of stateGeojson.features) {
            const s = (f.properties.state_name || '').toLowerCase();
            if (s === qLower || s.includes(qLower) || qLower.includes(s)) {
              if (googlePolygonLayer) {
                map.removeLayer(googlePolygonLayer);
                googlePolygonLayer = null;
              }
              const bounds = L.geoJson(f).getBounds();
              drillDownToState(f.properties.state_name, bounds);
              return;
            }
          }
        }

        alert(`Area or PIN '${query}' not found. Please enter a valid 6-digit PIN or city/district name.`);
      } catch (err) {
        console.error("Search processing error:", err);
      } finally {
        showLoader(false);
      }
    }

    // ==========================================
    // DEEP-DIVE TRAJECTORY COCKPIT MODAL LOGIC
    // ==========================================
    let currentCockpitHorizon = '3M';
    let currentCockpitTab = 'waterfall';
    let cockpitDataCache = null;

    function onCockpitKeyDown(e) {
      if (e.key === 'Escape') {
        closeCockpitModal();
      }
    }

    function openCockpitModal() {
      const modal = document.getElementById('cockpitModal');
      if (!modal) return;
      modal.style.display = 'flex';
      window.addEventListener('keydown', onCockpitKeyDown);
      loadCockpitData();
    }

    function closeCockpitModal() {
      const modal = document.getElementById('cockpitModal');
      if (modal) modal.style.display = 'none';
      window.removeEventListener('keydown', onCockpitKeyDown);
    }

    function handleCockpitBackdropClick(e) {
      if (e.target.id === 'cockpitModal') {
        closeCockpitModal();
      }
    }

    function setCockpitHorizon(horizon) {
      currentCockpitHorizon = horizon;
      const p3 = document.getElementById('cpill3M');
      const p6 = document.getElementById('cpill6M');
      const p1 = document.getElementById('cpill1Y');
      if (p3) p3.className = 'c-pill ' + (horizon === '3M' ? 'active' : '');
      if (p6) p6.className = 'c-pill ' + (horizon === '6M' ? 'active' : '');
      if (p1) p1.className = 'c-pill ' + (horizon === '1Y' ? 'active' : '');
      loadCockpitData();
    }

    function setCockpitTab(tab) {
      currentCockpitTab = tab;
      const tW = document.getElementById('cTabWaterfall');
      const tS = document.getElementById('cTabSourcing');
      const tR = document.getElementById('cTabRotation');
      if (tW) tW.className = 'cockpit-tab ' + (tab === 'waterfall' ? 'active' : '');
      if (tS) tS.className = 'cockpit-tab ' + (tab === 'sourcing' ? 'active' : '');
      if (tR) tR.className = 'cockpit-tab ' + (tab === 'rotation' ? 'active' : '');

      const pW = document.getElementById('paneWaterfall');
      const pS = document.getElementById('paneSourcing');
      const pR = document.getElementById('paneRotation');
      if (pW) pW.style.display = (tab === 'waterfall' ? 'flex' : 'none');
      if (pS) pS.style.display = (tab === 'sourcing' ? 'flex' : 'none');
      if (pR) pR.style.display = (tab === 'rotation' ? 'flex' : 'none');
    }

    async function loadCockpitData() {
      showLoader(true);
      try {
        let level = 'national';
        let query = `horizon=${currentCockpitHorizon}&level=national`;
        if (selectedPincode) {
          level = 'pincode';
          query = `horizon=${currentCockpitHorizon}&level=pincode&pincode=${selectedPincode}&state=${encodeURIComponent(selectedState||'')}&district=${encodeURIComponent(selectedDistrict||'')}`;
        } else if (selectedDistrict) {
          level = 'district';
          query = `horizon=${currentCockpitHorizon}&level=district&district=${encodeURIComponent(selectedDistrict)}&state=${encodeURIComponent(selectedState||'')}`;
        } else if (selectedState) {
          level = 'state';
          query = `horizon=${currentCockpitHorizon}&level=state&state=${encodeURIComponent(selectedState)}`;
        }

        const res = await fetch(`/api/multi_period_analytics?${query}`);
        const data = await res.json();
        cockpitDataCache = data;

        renderCockpitHeader(data);
        renderCockpitKpis(data);
        renderCockpitWaterfall(data);
        renderCockpitSourcing(data);
        renderCockpitRotation(data);
      } catch (err) {
        console.error("Failed to load cockpit data:", err);
      } finally {
        showLoader(false);
      }
    }

    function renderCockpitHeader(data) {
      const titleEl = document.getElementById('cockpitTitle');
      const subEl = document.getElementById('cockpitSubtitle');
      if (!titleEl || !subEl || !data || !data.entity) return;

      const mStart = data.months[0];
      const mEnd = data.months[data.months.length - 1];
      const periodLabel = data.horizon === '3M' ? 'Q1 FY27' : (data.horizon === '6M' ? 'H2 FY26' : 'Full FY26 Universe');

      titleEl.innerText = `${data.entity.title} — Multi-Period Trajectory`;
      subEl.innerText = `${mStart} to ${mEnd} (${data.months.length} Months · ${periodLabel}) | ${data.entity.subtitle}`;
    }

    function renderCockpitKpis(data) {
      const ribbon = document.getElementById('cockpitKpiRibbon');
      if (!ribbon || !data || !data.summary) return;

      const s = data.summary;
      const netSign = s.total_net_cr >= 0 ? '+' : '';
      const netClass = s.total_net_cr >= 0 ? 'green' : 'red';
      const lastW = (data.waterfall && data.waterfall.length) ? data.waterfall[data.waterfall.length - 1] : {};

      ribbon.innerHTML = `
        <div class="ckpi-card">
          <div class="ckpi-label-row">
            <span class="ckpi-label">Cumulative Net Retained</span>
            <span class="ckpi-tag ${netClass}">${s.overall_retention_pct}% Retained</span>
          </div>
          <div class="ckpi-val ${netClass}">${netSign}₹${s.total_net_cr.toFixed(2)} Cr</div>
          <div class="ckpi-sub">Total fresh wealth absorbed</div>
        </div>

        <div class="ckpi-card">
          <div class="ckpi-label-row">
            <span class="ckpi-label">Gross Capital Inflows</span>
            <span class="ckpi-tag blue">${data.months.length} Months Total</span>
          </div>
          <div class="ckpi-val">₹${s.total_gross_cr.toFixed(2)} Cr</div>
          <div class="ckpi-sub">Outflows: ₹${s.total_outflow_cr.toFixed(2)} Cr leaked</div>
        </div>

        <div class="ckpi-card">
          <div class="ckpi-label-row">
            <span class="ckpi-label">Latest SIP Run-Rate</span>
            <span class="ckpi-tag green">Sticky Money</span>
          </div>
          <div class="ckpi-val">₹${(s.latest_sip_cr||0).toFixed(2)} Cr/mo</div>
          <div class="ckpi-sub">${(lastW.sip_count||0).toLocaleString()} debits (₹${Math.round(lastW.avg_sip_ticket_inr||0)} avg)</div>
        </div>

        <div class="ckpi-card">
          <div class="ckpi-label-row">
            <span class="ckpi-label">Snapshot Closing AUM</span>
            <span class="ckpi-tag blue">Footprint</span>
          </div>
          <div class="ckpi-val">₹${(s.latest_aum_cr||0).toFixed(2)} Cr</div>
          <div class="ckpi-sub">${(s.latest_mfds||0).toLocaleString()} Active competing MFDs</div>
        </div>
      `;
    }

    function renderCockpitWaterfall(data) {
      const wrap = document.getElementById('waterfallTableWrap');
      if (!wrap || !data || !data.waterfall) return;

      const wf = data.waterfall;
      const maxNet = Math.max(...wf.map(r => Math.abs(r.net_cr || 0)), 1);

      let rowsHtml = wf.map(r => {
        const netSign = r.net_cr >= 0 ? '+' : '';
        const netColor = r.net_cr >= 0 ? '#15803d' : '#b91c1c';
        const barFillClass = r.net_cr >= 0 ? 'pos' : 'neg';
        const barWidthPct = Math.min(100, Math.round((Math.abs(r.net_cr) / maxNet) * 100));

        return `
          <tr>
            <td style="font-weight:700; color:#0f172a;">${r.month}</td>
            <td class="t-right" style="color:#0369a1; font-weight:600;">₹${r.gross_cr.toFixed(2)} Cr</td>
            <td class="t-right" style="color:#64748b;">₹${r.outflow_cr.toFixed(2)} Cr</td>
            <td class="t-right" style="color:${netColor}; font-weight:700;">${netSign}₹${r.net_cr.toFixed(2)} Cr</td>
            <td class="t-center">
              <span style="font-weight:700; color:${r.retention_pct>=25?'#15803d':'#b45309'};">${r.retention_pct}%</span>
            </td>
            <td>
              <div class="net-flow-bar-cell">
                <div class="net-bar-track">
                  <div class="net-bar-fill ${barFillClass}" style="width:${barWidthPct}%;"></div>
                </div>
                <span style="font-size:0.65rem; color:#64748b; width:35px; text-align:right;">${barWidthPct}%</span>
              </div>
            </td>
            <td class="t-right" style="font-weight:700; color:#0f172a;">₹${r.aum_cr.toFixed(2)} Cr</td>
          </tr>
        `;
      }).join('');

      // Totals / Summary Row
      const s = data.summary;
      const totNetSign = s.total_net_cr >= 0 ? '+' : '';
      const totNetColor = s.total_net_cr >= 0 ? '#15803d' : '#b91c1c';

      const tableHtml = `
        <div class="cockpit-table-container">
          <table class="cockpit-table">
            <thead>
              <tr>
                <th>Period Month</th>
                <th class="t-right">Gross Inflow</th>
                <th class="t-right">Redemptions / Outflows</th>
                <th class="t-right">Net Business Retained</th>
                <th class="t-center">Retention Rate</th>
                <th class="t-right" style="padding-right:30px;">Net Momentum Flow</th>
                <th class="t-right">Closing AUM</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
              <tr class="total-row">
                <td>Cumulative / Latest</td>
                <td class="t-right" style="color:#0369a1;">₹${s.total_gross_cr.toFixed(2)} Cr</td>
                <td class="t-right" style="color:#64748b;">₹${s.total_outflow_cr.toFixed(2)} Cr</td>
                <td class="t-right" style="color:${totNetColor}; font-size:0.88rem;">${totNetSign}₹${s.total_net_cr.toFixed(2)} Cr</td>
                <td class="t-center" style="font-size:0.84rem; color:#15803d;">${s.overall_retention_pct}%</td>
                <td class="t-right" style="font-size:0.68rem; color:#64748b;">Overall Trajectory</td>
                <td class="t-right" style="color:#0f172a; font-size:0.88rem;">₹${(s.latest_aum_cr||0).toFixed(2)} Cr</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;

      // Vertical Column Bars (1 Bar per Month, Retained Value up at top, Redemptions at bottom)
      const maxGross = Math.max(...wf.map(r => r.gross_cr || 0), 1);
      const isCompact = (wf.length > 6); // 1Y view

      const formatShortCr = (v) => {
        const absV = Math.abs(v);
        if (absV >= 1000) return `₹${(v / 1000).toFixed(1)}k Cr`;
        return `₹${v.toFixed(0)} Cr`;
      };

      const verticalColsHtml = wf.map(r => {
        const netSign = r.net_cr >= 0 ? '+' : '';
        const isPos = r.net_cr >= 0;
        const gross = r.gross_cr || 0;
        const outflow = r.outflow_cr || 0;

        // Column bar total height proportional to Gross Inflow (min 50px, max 135px)
        const barHeightPx = Math.max(50, Math.round((gross / maxGross) * 135));

        // Retention % calculation
        const retPct = Math.max(0, Math.min(100, r.retention_pct || 0));
        const leakPct = Math.max(0, 100 - retPct);

        let segmentsHtml = '';
        if (isPos) {
          // Top segment = Retained (Emerald Green)
          // Bottom segment = Outflows / Redemptions (Soft Coral Red)
          segmentsHtml = `
            <div class="wf-vseg-retained" style="height:${retPct}%;" title="Retained: ₹${r.net_cr.toFixed(2)} Cr (${retPct}%)"></div>
            <div class="wf-vseg-outflow" style="height:${leakPct}%;" title="Outflows / Redemptions: ₹${outflow.toFixed(2)} Cr (${leakPct.toFixed(1)}%)"></div>
          `;
        } else {
          // Entire bar is negative drain
          segmentsHtml = `
            <div class="wf-vseg-drain" title="Excess Outflow Drain: ₹${r.net_cr.toFixed(2)} Cr"></div>
          `;
        }

        const netDisplay = formatShortCr(r.net_cr);
        const grossDisplay = formatShortCr(gross);
        const outDisplay = formatShortCr(outflow);
        const monthLabel = isCompact ? r.month.split('-')[0] : r.month;

        return `
          <div class="wf-vcol" title="${r.month}: Gross ${grossDisplay} | Outflow ${outDisplay} | Net ${netSign}${r.net_cr.toFixed(2)} Cr (${r.retention_pct}%)">
            <!-- Top Metric: Retained Value + Badge -->
            <div class="wf-vcol-top">
              <span class="wf-vnet-val ${isPos ? 'pos' : 'neg'}">${netSign}${netDisplay}</span>
              <span class="wf-vret-badge ${isPos ? 'pos' : 'neg'}">${r.retention_pct}%</span>
            </div>

            <!-- Vertical Bar Stack: Retained UP, Redemptions BOTTOM -->
            <div class="wf-vbar-track" style="height:${barHeightPx}px;">
              ${segmentsHtml}
            </div>

            <!-- Bottom Labels: Month + Gross + Outflow -->
            <div class="wf-vcol-bottom">
              <span class="wf-vcol-month">${monthLabel}</span>
              <span class="wf-vcol-gross">${grossDisplay}</span>
              <span class="wf-vcol-out">Out: ${outDisplay}</span>
            </div>
          </div>
        `;
      }).join('');

      // Visual Card Wrapper
      const isTotalPos = s.total_net_cr >= 0;
      const periodName = data.horizon === '3M' ? '3 Months (Q1 FY27)' : (data.horizon === '6M' ? '6 Months (H2 FY26)' : '1 Year (Full FY26)');

      const visualCardHtml = `
        <div class="waterfall-visual-card">
          <div class="wf-vis-head">
            <span class="wf-vis-title">Monthly Capital Dynamics (1 Bar per Month · Retained Value at Top · Redemptions at Bottom)</span>
            <div class="wf-vis-legend">
              <span class="wf-leg-item"><span class="wf-leg-dot" style="background:#10b981;"></span> Retained Capital (Top)</span>
              <span class="wf-leg-item"><span class="wf-leg-dot" style="background:#fca5a5;"></span> Redemptions / Outflows (Bottom)</span>
            </div>
          </div>

          <!-- Vertical Bar Canvas -->
          <div class="wf-vertical-canvas">
            ${verticalColsHtml}
          </div>

          <!-- Summary Strip -->
          <div class="wf-total-card">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:0.75rem; font-weight:800; color:#0f172a; font-family:'JetBrains Mono'; text-transform:uppercase;">${periodName} Cumulative</span>
              <span class="wf-vret-badge pos" style="font-size:0.70rem; padding:2px 7px;">${s.overall_retention_pct}% Total Retention</span>
            </div>
            <div style="font-family:'JetBrains Mono'; font-size:0.74rem;">
              <span style="font-weight:800; color:#15803d;">${isTotalPos ? '+' : ''}₹${s.total_net_cr.toFixed(2)} Cr Retained</span>
              <span style="color:#64748b; margin-left:8px;">out of ₹${s.total_gross_cr.toFixed(2)} Cr Gross (Outflows: ₹${s.total_outflow_cr.toFixed(2)} Cr)</span>
            </div>
          </div>
        </div>
      `;

      wrap.innerHTML = visualCardHtml + tableHtml;
    }

    function renderCockpitSourcing(data) {
      const wrap = document.getElementById('cockpitSourcingWrap');
      if (!wrap || !data || !data.waterfall) return;

      const wf = data.waterfall;

      const formatAum = (v) => {
        if (!v) return '₹0 Cr';
        if (v >= 100000) return `₹${(v / 100000).toFixed(2)} L Cr`;
        if (v >= 1000) return `₹${(v / 1000).toFixed(1)}k Cr`;
        return `₹${v.toFixed(2)} Cr`;
      };

      const formatDebits = (c) => {
        if (!c) return '0 Debits';
        if (c >= 10000000) return `${(c / 10000000).toFixed(2)} Cr Debits`;
        if (c >= 100000) return `${(c / 100000).toFixed(1)} L Debits`;
        return `${c.toLocaleString()} Debits`;
      };

      // Enhanced Section 2: Visual 100% Split + Direct Core Metrics
      const chartRowsHtml = wf.map(r => {
        return `
          <div class="sourcing-bar-row">
            <!-- 1. Month & Gross -->
            <div class="s-row-month-wrap">
              <span class="s-row-month">${r.month}</span>
              <span class="s-row-gross-sub">Gross ₹${r.gross_cr.toFixed(0)} Cr</span>
            </div>

            <!-- 2. 100% Stacked Sourcing Track -->
            <div class="s-row-track-wrap">
              <div class="s-row-track" title="Gross: ₹${r.gross_cr.toFixed(2)} Cr | Lump: ${r.lump_pct}% | SIP: ${r.sip_pct}% | STP: ${r.stp_pct}%">
                <div class="s-seg-lump" style="width:${r.lump_pct}%;" title="Lumpsum: ₹${(r.lumpsum_cr||0).toFixed(2)} Cr (${r.lump_pct}%)"></div>
                <div class="s-seg-sip" style="width:${r.sip_pct}%;" title="SIP Harvest: ₹${(r.sip_cr||0).toFixed(2)} Cr (${r.sip_pct}%)"></div>
                <div class="s-seg-stp" style="width:${r.stp_pct}%;" title="STP Inflow: ₹${(r.stp_cr||0).toFixed(2)} Cr (${r.stp_pct}%)"></div>
              </div>
              <div class="s-row-legend">
                <span class="s-leg-item" style="color:#2563eb;"><strong>${r.lump_pct}%</strong> Lump</span>
                <span class="s-leg-item" style="color:#10b981;"><strong>${r.sip_pct}%</strong> SIP</span>
                <span class="s-leg-item" style="color:#f59e0b;"><strong>${r.stp_pct}%</strong> STP</span>
              </div>
            </div>

            <!-- 3. Monthly SIP Harvest -->
            <div class="s-metric-cell">
              <span class="s-metric-val sip-green">₹${(r.sip_cr||0).toFixed(2)} Cr</span>
              <span class="s-metric-sub">${formatDebits(r.sip_count||0)}</span>
            </div>

            <!-- 4. Avg SIP Ticket -->
            <div class="s-metric-cell">
              <span class="s-metric-val">₹${Math.round(r.avg_sip_ticket_inr||0).toLocaleString()}</span>
              <span class="s-metric-sub">/ debit</span>
            </div>

            <!-- 5. Active MFDs -->
            <div class="s-metric-cell">
              <span class="s-metric-val mfd-blue">${(r.active_mfds||0).toLocaleString()}</span>
              <span class="s-metric-sub">Active MFDs</span>
            </div>

            <!-- 6. Closing AUM -->
            <div class="s-metric-cell">
              <span class="s-metric-val">${formatAum(r.aum_cr||0)}</span>
              <span class="s-metric-sub">Closing AUM</span>
            </div>
          </div>
        `;
      }).join('');

      // Trajectory Delta Summary (First vs Last Month)
      const firstW = wf[0] || {};
      const lastW = wf[wf.length - 1] || {};
      const dSip = (lastW.sip_cr || 0) - (firstW.sip_cr || 0);
      const dSipSign = dSip >= 0 ? '+' : '';
      const dTicket = Math.round((lastW.avg_sip_ticket_inr || 0) - (firstW.avg_sip_ticket_inr || 0));
      const dTicketSign = dTicket >= 0 ? '+' : '';
      const dMfd = (lastW.active_mfds || 0) - (firstW.active_mfds || 0);
      const dMfdSign = dMfd >= 0 ? '+' : '';
      const dAum = (lastW.aum_cr || 0) - (firstW.aum_cr || 0);
      const dAumSign = dAum >= 0 ? '+' : '';

      const trajectoryFooterHtml = `
        <div class="sourcing-trajectory-footer">
          <span class="s-traj-tag">${data.horizon} Trajectory Trend</span>
          <div class="s-traj-items">
            <div class="s-traj-stat">
              <span>SIP Run-Rate:</span>
              <strong>₹${(firstW.sip_cr||0).toFixed(1)} ➔ ₹${(lastW.sip_cr||0).toFixed(1)} Cr</strong>
              <span class="${dSip >= 0 ? 'delta-pos' : 'delta-neg'}">(${dSipSign}₹${dSip.toFixed(1)} Cr)</span>
            </div>
            <div class="s-traj-stat">
              <span>Avg Ticket:</span>
              <strong>₹${Math.round(firstW.avg_sip_ticket_inr||0)} ➔ ₹${Math.round(lastW.avg_sip_ticket_inr||0)}</strong>
              <span class="${dTicket >= 0 ? 'delta-pos' : 'delta-neg'}">(${dTicketSign}₹${dTicket}/debit)</span>
            </div>
            <div class="s-traj-stat">
              <span>Active MFDs:</span>
              <strong>${(firstW.active_mfds||0).toLocaleString()} ➔ ${(lastW.active_mfds||0).toLocaleString()}</strong>
              <span class="${dMfd >= 0 ? 'delta-pos' : 'delta-neg'}">(${dMfdSign}${dMfd.toLocaleString()})</span>
            </div>
            <div class="s-traj-stat">
              <span>AUM Base:</span>
              <strong>${formatAum(firstW.aum_cr||0)} ➔ ${formatAum(lastW.aum_cr||0)}</strong>
              <span class="${dAum >= 0 ? 'delta-pos' : 'delta-neg'}">(${dAumSign}₹${Math.abs(dAum).toFixed(1)} Cr)</span>
            </div>
          </div>
        </div>
      `;

      // Precision Sourcing & Distribution Table
      const tableRowsHtml = wf.map(r => {
        return `
          <tr>
            <td style="font-weight:700; color:#0f172a;">${r.month}</td>
            <td class="t-right" style="font-weight:700;">₹${r.gross_cr.toFixed(2)} Cr</td>
            <td class="t-right" style="color:#2563eb;">₹${(r.lumpsum_cr||0).toFixed(2)} Cr</td>
            <td class="t-center"><span style="color:#2563eb; font-weight:700;">${r.lump_pct}%</span></td>
            <td class="t-right" style="color:#15803d; font-weight:700;">₹${(r.sip_cr||0).toFixed(2)} Cr</td>
            <td class="t-center"><span style="color:#15803d; font-weight:700;">${r.sip_pct}%</span></td>
            <td class="t-right" style="color:#d97706;">₹${(r.stp_cr||0).toFixed(2)} Cr</td>
            <td class="t-center"><span style="color:#d97706; font-weight:700;">${r.stp_pct}%</span></td>
            <td class="t-right">${(r.sip_count||0).toLocaleString()}</td>
            <td class="t-right" style="font-weight:700; color:#0f172a;">₹${Math.round(r.avg_sip_ticket_inr||0).toLocaleString()}</td>
            <td class="t-right" style="font-weight:700; color:#0369a1;">${(r.active_mfds||0).toLocaleString()}</td>
            <td class="t-right" style="font-weight:700; color:#0f172a;">${formatAum(r.aum_cr||0)}</td>
          </tr>
        `;
      }).join('');

      wrap.innerHTML = `
        <div class="sourcing-chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <span style="font-size:0.82rem; font-weight:800; color:#0f172a;">Monthly Sourcing Split & Systematic Distribution Engine</span>
              <div style="font-size:0.67rem; color:#64748b;">100% Inflow Stack with Direct SIP Harvest, Avg Ticket, Active MFD Network & Closing AUM</div>
            </div>
            <div style="display:flex; gap:12px; font-size:0.70rem; font-weight:600;">
              <span style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:2px; background:#3b82f6;"></span> Tactical Lumpsum</span>
              <span style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:2px; background:#10b981;"></span> Compounding SIP</span>
              <span style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:2px; background:#f59e0b;"></span> Systematic STP</span>
            </div>
          </div>

          <!-- Column Header Guide -->
          <div class="sourcing-grid-header">
            <span>Month</span>
            <span>Inflow Sourcing Split</span>
            <span>SIP Harvest</span>
            <span>Avg Ticket</span>
            <span>Active MFDs</span>
            <span>Closing AUM</span>
          </div>

          <!-- Monthly Rows -->
          <div style="display:flex; flex-direction:column; gap:4px;">
            ${chartRowsHtml}
          </div>

          <!-- Trajectory Footer -->
          ${trajectoryFooterHtml}
        </div>

        <div class="cockpit-table-container">
          <table class="cockpit-table">
            <thead>
              <tr>
                <th>Month</th>
                <th class="t-right">Total Inflow</th>
                <th class="t-right">Lumpsum (Cr)</th>
                <th class="t-center">Lump Share</th>
                <th class="t-right">SIP Book (Cr)</th>
                <th class="t-center">SIP Share</th>
                <th class="t-right">STP Inflow (Cr)</th>
                <th class="t-center">STP Share</th>
                <th class="t-right">Active Debits</th>
                <th class="t-right">Avg Ticket / Debit</th>
                <th class="t-right">Active MFDs</th>
                <th class="t-right">Closing AUM</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
            </tbody>
          </table>
        </div>
      `;
    }

    let currentRotationSort = 'net';

    window.setRotationSort = function(sortType) {
      currentRotationSort = sortType;
      if (cockpitDataCache) {
        renderCockpitRotation(cockpitDataCache);
      }
    };

    function renderCockpitRotation(data) {
      const wrap = document.getElementById('cockpitRotationWrap');
      if (!wrap || !data || !data.product_rotation) return;

      const schemes = data.product_rotation;
      if (!schemes || schemes.length === 0) {
        wrap.innerHTML = `<div style="padding:20px; text-align:center; color:#64748b;">No product rotation data available for this horizon.</div>`;
        return;
      }

      const formatCr = (v) => {
        const absV = Math.abs(v);
        if (absV >= 1000) return `₹${(v / 1000).toFixed(1)}k Cr`;
        return `₹${v.toFixed(1)} Cr`;
      };

      const formatAum = (v) => {
        if (!v) return '₹0 Cr';
        if (v >= 100000) return `₹${(v / 100000).toFixed(2)} L Cr`;
        if (v >= 1000) return `₹${(v / 1000).toFixed(1)}k Cr`;
        return `₹${v.toFixed(1)} Cr`;
      };

      // 1. Build rank maps across all dimensions
      const byInflow = [...schemes].sort((a, b) => (b.total_gross || 0) - (a.total_gross || 0));
      const bySip = [...schemes].sort((a, b) => (b.latest_sip || 0) - (a.latest_sip || 0));
      const byAum = [...schemes].sort((a, b) => (b.latest_aum || 0) - (a.latest_aum || 0));
      const byNet = [...schemes].sort((a, b) => (b.total_net || 0) - (a.total_net || 0));

      const inflowRankMap = {};
      const sipRankMap = {};
      const aumRankMap = {};
      const netRankMap = {};

      byInflow.forEach((s, i) => { inflowRankMap[s.scheme_type] = i + 1; });
      bySip.forEach((s, i) => { sipRankMap[s.scheme_type] = i + 1; });
      byAum.forEach((s, i) => { aumRankMap[s.scheme_type] = i + 1; });
      byNet.forEach((s, i) => { netRankMap[s.scheme_type] = i + 1; });

      const getRankClass = (idx) => idx === 1 ? 'gold' : (idx === 2 ? 'silver' : (idx === 3 ? 'bronze' : ''));

      // 2. Pillar 1: Top 5 Inflow Leaders
      const inflowTop5Html = byInflow.slice(0, 5).map((s, i) => {
        const netSign = s.total_net >= 0 ? '+' : '';
        const netColor = s.total_net >= 0 ? '#15803d' : '#b91c1c';
        return `
          <div class="rot-pillar-item">
            <div class="rot-item-left">
              <span class="rot-rank-num ${getRankClass(i+1)}">#${i+1}</span>
              <span class="rot-item-name" title="${s.scheme_type}">${s.scheme_type}</span>
            </div>
            <div class="rot-item-right">
              <div class="rot-item-val" style="color:#0284c7;">${formatCr(s.total_gross)}</div>
              <div class="rot-item-sub" style="color:${netColor}; font-weight:700;">Net: ${netSign}${formatCr(s.total_net)}</div>
            </div>
          </div>
        `;
      }).join('');

      // 3. Pillar 2: Top 5 SIP Book Leaders
      const sipTop5Html = bySip.slice(0, 5).map((s, i) => {
        return `
          <div class="rot-pillar-item">
            <div class="rot-item-left">
              <span class="rot-rank-num ${getRankClass(i+1)}">#${i+1}</span>
              <span class="rot-item-name" title="${s.scheme_type}">${s.scheme_type}</span>
            </div>
            <div class="rot-item-right">
              <div class="rot-item-val" style="color:#15803d;">₹${(s.latest_sip||0).toFixed(1)} Cr/mo</div>
              <div class="rot-item-sub">${s.asset_class}</div>
            </div>
          </div>
        `;
      }).join('');

      // 4. Pillar 3: Top 5 Closing AUM Champions
      const aumTop5Html = byAum.slice(0, 5).map((s, i) => {
        return `
          <div class="rot-pillar-item">
            <div class="rot-item-left">
              <span class="rot-rank-num ${getRankClass(i+1)}">#${i+1}</span>
              <span class="rot-item-name" title="${s.scheme_type}">${s.scheme_type}</span>
            </div>
            <div class="rot-item-right">
              <div class="rot-item-val" style="color:#0f172a;">${formatAum(s.latest_aum)}</div>
              <div class="rot-item-sub">${s.asset_class}</div>
            </div>
          </div>
        `;
      }).join('');

      // 5. Sorted list for Master Table based on currentRotationSort
      let displaySchemes = [...schemes];
      if (currentRotationSort === 'inflow') {
        displaySchemes = byInflow;
      } else if (currentRotationSort === 'sip') {
        displaySchemes = bySip;
      } else if (currentRotationSort === 'aum') {
        displaySchemes = byAum;
      } else { // default 'net'
        displaySchemes = byNet;
      }

      const rowsHtml = displaySchemes.map((s, idx) => {
        const infR = inflowRankMap[s.scheme_type] || '-';
        const sipR = sipRankMap[s.scheme_type] || '-';
        const aumR = aumRankMap[s.scheme_type] || '-';

        const netSign = s.total_net >= 0 ? '+' : '';
        const netColor = s.total_net >= 0 ? '#15803d' : '#b91c1c';

        // Strategic Character Determination
        let charBadge = '';
        if (aumR <= 3 && sipR <= 3) {
          charBadge = `<span class="char-badge anchor" title="Dominates both SIP retention and overall wealth base">👑 Core Wealth Anchor</span>`;
        } else if (sipR <= 5 && infR > 5) {
          const rankGain = infR - sipR;
          charBadge = `<span class="char-badge sip-surge" title="High organic retail investor loyalty">⚡ SIP Surge (+${rankGain} Ranks)</span>`;
        } else if (infR <= 3 && sipR > 10) {
          const rankDrop = sipR - infR;
          charBadge = `<span class="char-badge churn" title="Massive gross volume with negligible retail stickiness">⚠️ Treasury Churn (-${rankDrop} SIP)</span>`;
        } else if (s.total_net < 0) {
          charBadge = `<span class="char-badge churn" title="Outflows exceeding fresh money">🔴 Capital Drain</span>`;
        } else if (s.total_net >= 2500) {
          charBadge = `<span class="char-badge accum" title="Substantial positive capital absorption">🚀 Net Accumulator</span>`;
        } else {
          charBadge = `<span class="char-badge steady">🟢 Steady Flow</span>`;
        }

        return `
          <tr>
            <td class="t-center" style="font-weight:800; color:#64748b; font-family:'JetBrains Mono',monospace;">#${idx + 1}</td>
            <td>
              <div style="font-weight:700; color:#0f172a;">${s.scheme_type}</div>
              <div style="font-size:0.66rem; color:#64748b;">${s.asset_class}</div>
            </td>
            <td>
              <div class="triple-rank-wrap">
                <span class="t-rank-pill inflow" title="Inflow Rank">Inflow #${infR}</span>
                <span class="t-rank-pill sip" title="SIP Book Rank">SIP #${sipR}</span>
                <span class="t-rank-pill aum" title="AUM Rank">AUM #${aumR}</span>
              </div>
            </td>
            <td class="t-right" style="font-weight:700; color:#0369a1;">₹${(s.total_gross||0).toFixed(2)} Cr</td>
            <td class="t-right">
              <span style="font-weight:800; color:${netColor};">${netSign}₹${(s.total_net||0).toFixed(2)} Cr</span>
              <div style="font-size:0.62rem; color:${netColor}; font-weight:700;">${s.retention_pct || 0}% Retained</div>
            </td>
            <td class="t-right" style="font-weight:700; color:#15803d;">₹${(s.latest_sip||0).toFixed(2)} Cr/mo</td>
            <td class="t-right" style="font-weight:700; color:#0f172a;">${formatAum(s.latest_aum||0)}</td>
            <td class="t-center">${charBadge}</td>
          </tr>
        `;
      }).join('');

      wrap.innerHTML = `
        <!-- 1. 3-Pillar Parallel Leaderboards -->
        <div class="rotation-pillars-grid">
          <!-- Pillar 1: Inflow Leaders -->
          <div class="rot-pillar-card inflow-pillar">
            <div class="rot-pillar-header">
              <div>
                <span class="rot-pillar-title">🌊 Inflow Volume Leaders</span>
                <div class="rot-pillar-sub">${data.horizon} Total Inflow Gross</div>
              </div>
              <span class="rot-pillar-badge blue">Turnover</span>
            </div>
            <div class="rot-pillar-list">
              ${inflowTop5Html}
            </div>
          </div>

          <!-- Pillar 2: SIP Book Leaders -->
          <div class="rot-pillar-card sip-pillar">
            <div class="rot-pillar-header">
              <div>
                <span class="rot-pillar-title">⚡ SIP Run-Rate Leaders</span>
                <div class="rot-pillar-sub">Monthly Compounding Flow</div>
              </div>
              <span class="rot-pillar-badge green">Sticky</span>
            </div>
            <div class="rot-pillar-list">
              ${sipTop5Html}
            </div>
          </div>

          <!-- Pillar 3: Closing AUM Leaders -->
          <div class="rot-pillar-card aum-pillar">
            <div class="rot-pillar-header">
              <div>
                <span class="rot-pillar-title">🏦 Closing AUM Giants</span>
                <div class="rot-pillar-sub">Accumulated Asset Base</div>
              </div>
              <span class="rot-pillar-badge dark">Wealth</span>
            </div>
            <div class="rot-pillar-list">
              ${aumTop5Html}
            </div>
          </div>
        </div>

        <!-- 2. Controls & Sort Switcher -->
        <div class="rot-controls-bar">
          <div>
            <div class="rot-controls-title">Strategic Category Rotation & Position Ledger</div>
            <div style="font-size:0.66rem; color:#64748b;">Compare Inflow Rank vs SIP Rank vs AUM Rank to detect disconnects and capital migration</div>
          </div>
          <div class="rot-sort-group">
            <span class="rot-sort-label">Sort By:</span>
            <button class="rot-sort-btn ${currentRotationSort === 'net' ? 'active' : ''}" onclick="setRotationSort('net')">🏆 Net Retained</button>
            <button class="rot-sort-btn ${currentRotationSort === 'sip' ? 'active' : ''}" onclick="setRotationSort('sip')">⚡ SIP Book</button>
            <button class="rot-sort-btn ${currentRotationSort === 'aum' ? 'active' : ''}" onclick="setRotationSort('aum')">🏦 Closing AUM</button>
            <button class="rot-sort-btn ${currentRotationSort === 'inflow' ? 'active' : ''}" onclick="setRotationSort('inflow')">🌊 Gross Inflow</button>
          </div>
        </div>

        <!-- 3. Master Rotation Table with Triple-Rank Profile -->
        <div class="cockpit-table-container" style="margin-top:8px;">
          <table class="cockpit-table">
            <thead>
              <tr>
                <th class="t-center" style="width:36px;">#</th>
                <th>Scheme Category & Class</th>
                <th style="width:145px;">Triple-Rank</th>
                <th class="t-right">Gross Inflow</th>
                <th class="t-right">Net Absorbed</th>
                <th class="t-right">Monthly SIP</th>
                <th class="t-right">Closing AUM</th>
                <th class="t-center">Strategic Signal</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    }