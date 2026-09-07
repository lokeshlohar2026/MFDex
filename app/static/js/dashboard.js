// Basemap Layers: Esri Light Gray Canvas, OpenStreetMap Contour / Street, and Esri Satellite
    const map = L.map('map', { zoomControl: true, minZoom: 4, maxZoom: 18 }).setView([22.5, 79.5], 5);
    
    const lightCanvas = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      attribution: 'Esri Light'
    }).addTo(map);

    const contourOsm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    });

    const satelliteImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: 'Esri Satellite'
    });

    const satelliteLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: 'Esri Reference'
    });

    const satelliteGroup = L.layerGroup([satelliteImagery, satelliteLabels]);

    let currentBasemap = 'canvas';
    function setBasemap(mode) {
      currentBasemap = mode;
      document.getElementById('btnMapCanvas').className = 'mode-btn ' + (mode === 'canvas' ? 'active' : '');
      document.getElementById('btnMapContour').className = 'mode-btn ' + (mode === 'contour' ? 'active' : '');
      document.getElementById('btnMapSatellite').className = 'mode-btn ' + (mode === 'satellite' ? 'active' : '');

      map.removeLayer(lightCanvas);
      map.removeLayer(contourOsm);
      map.removeLayer(satelliteGroup);

      if (mode === 'contour') {
        map.addLayer(contourOsm);
      } else if (mode === 'satellite') {
        map.addLayer(satelliteGroup);
      } else {
        map.addLayer(lightCanvas);
      }
    }

    // State, District, and Pincode Layer Groups
    let stateGeojson = null;
    let districtGeojson = null;
    let stateLayer = null;
    let districtLayer = null;
    let pinDotsLayerGroup = L.layerGroup().addTo(map);
    let heatLayer = null;

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
          currentHorizon = currentMonth;
          updateHorizonPillUI();
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
      currentHorizon = currentMonth;
      updateHorizonPillUI();
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
          renderSidebarNational(natData.summary, natData.schemes, natData.monthly_trends, natData.scheme_rotation);
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
      const lumpsum = Math.max(0, gross - sip - stp);
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
            fillColor: isSelected ? '#2563eb' : 'transparent',
            weight: isSelected ? 2.5 : 1.2,
            color: isSelected ? '#1d4ed8' : 'rgba(37, 99, 235, 0.45)',
            dashArray: isSelected ? '' : '4, 4',
            fillOpacity: isSelected ? 0.08 : 0
          };
        },
        onEachFeature: function(feature, layer) {
          const sName = feature.properties.state_name;
          const sObj = stateSummaries[sName];

          if (sObj) {
            layer.bindTooltip(`
              <div style="font-family:'JetBrains Mono'; font-size:11px;">
                <b style="color:#2563eb;font-size:12px;">${sName}</b><br/>
                Gross: <b>₹${sObj.gross_cr.toLocaleString()} Cr</b><br/>
                Net: <b>${sObj.net_cr >= 0 ? '+' : ''}₹${sObj.net_cr.toLocaleString()} Cr</b><br/>
                SIP: <b>₹${sObj.sip_cr.toLocaleString()} Cr</b><br/>
                <span style="color:#64748b;font-size:10px;">Active MFDs: ${sObj.active_mfds}</span>
              </div>
            `, { sticky: true });
          }

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
          const isSelected = (selectedDistrict === dName);
          return {
            fillColor: isSelected ? '#7c3aed' : 'transparent',
            weight: isSelected ? 2.5 : 1.0,
            color: isSelected ? '#7c3aed' : 'rgba(124, 58, 237, 0.45)',
            dashArray: isSelected ? '' : '2, 3',
            fillOpacity: isSelected ? 0.12 : 0
          };
        },
        onEachFeature: function(feature, layer) {
          const dName = feature.properties.district || '';
          layer.bindTooltip(`
            <div style="font-family:'JetBrains Mono'; font-size:11px;">
              <b style="color:#7c3aed;font-size:12px;">🏙️ ${dName}</b><br/>
              <span style="color:#64748b;font-size:10px;">Click to inspect district micro-market</span>
            </div>
          `, { sticky: true });

          layer.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            drillDownToDistrict(dName, selectedState, layer.getBounds());
          });
        }
      }).addTo(map);
    }

    async function drillDownToDistrict(districtName, stateName, bounds) {
      selectedDistrict = districtName;
      selectedPincode = null;
      document.getElementById('breadcrumbText').innerText = `All India > ${stateName} > ${districtName}`;
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
          renderSidebarPincode(data.summary, data.schemes, data.monthly_trends, data.scheme_rotation);
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
          renderSidebarDistrict(data.summary, data.schemes, data.monthly_trends, data.scheme_rotation);
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
          renderSidebarState(data.summary, data.schemes, data.monthly_trends, data.scheme_rotation);
        }
      } catch (e) {
        console.error("Error loading state details:", e);
      } finally {
        showLoader(false);
      }
    }

    function renderSidebarNational(sum, schemes, trends, rotation) {
      document.getElementById('sideTierTag').innerText = "National Universe";
      document.getElementById('sideTitle').innerText = "All India Front";
      document.getElementById('sideSubtitle').innerText = "Verified Independent MFD & RIA Telemetry";

      renderMetricsToSidebar(
        sum.nat_net || 0, sum.nat_gross || 0, sum.nat_outflow || 0,
        sum.nat_sip || 0, sum.nat_stp || 0, sum.nat_sip_cnt || 0, sum.avg_sip_ticket || 0,
        sum.nat_aum || 0, sum.nat_mfds_footprint || 0, schemes, trends, rotation
      );
    }

    function renderSidebarState(sum, schemes, trends, rotation) {
      document.getElementById('sideTierTag').innerText = "State Regional Tier";
      document.getElementById('sideTitle').innerText = sum.state;
      document.getElementById('sideSubtitle').innerText = `${(sum.pincodes_count || 0).toLocaleString()} Active Postal Pincodes`;

      renderMetricsToSidebar(
        sum.total_net_added_cr || 0, sum.total_gross_cr || 0, sum.total_redemptions_cr || 0,
        sum.total_sip_cr || 0, sum.total_stp_cr || 0, sum.total_sip_count || 0, sum.avg_sip_ticket_inr || 0,
        sum.total_aum_cr || 0, sum.active_mfds || 0, schemes, trends, rotation
      );
    }

    function renderSidebarDistrict(sum, schemes, trends, rotation) {
      document.getElementById('sideTierTag').innerText = "District Market Tier";
      document.getElementById('sideTitle').innerText = sum.district;
      document.getElementById('sideSubtitle').innerText = `District in ${sum.state} (${sum.pincodes_count || 0} PINs)`;

      renderMetricsToSidebar(
        sum.total_net_added_cr || 0, sum.total_gross_cr || 0, sum.total_redemptions_cr || 0,
        sum.total_sip_cr || 0, sum.total_stp_cr || 0, sum.total_sip_count || 0, sum.avg_sip_ticket_inr || 0,
        sum.total_aum_cr || 0, sum.total_mfds_footprint || 0, schemes, trends, rotation
      );
    }

    function renderSidebarPincode(sum, schemes, trends, rotation) {
      document.getElementById('sideTierTag').innerText = "Micro-Market Pincode";
      document.getElementById('sideTitle').innerText = `PIN ${sum.pincode}`;
      document.getElementById('sideSubtitle').innerText = `${sum.city || 'City'}, ${sum.state} (${sum.district || 'District'})`;

      renderMetricsToSidebar(
        sum.total_net_added_cr || 0, sum.total_gross_cr || 0, sum.total_redemptions_cr || 0,
        sum.total_sip_cr || 0, sum.total_stp_cr || 0, sum.total_sip_count || 0, sum.avg_sip_ticket_inr || 0,
        sum.total_aum_cr || 0, sum.active_mfds || 0, schemes, trends, rotation
      );
    }

    function renderMetricsToSidebar(net, gross, outflow, sip, stp, sipCount, avgTicket, aum, mfds, schemes, trends, rotation) {
      currentTrends = trends || [];
      currentSchemeRotation = rotation || [];
      currentSchemes = schemes || [];

      // Update pill active states in Horizon Stepper
      updateHorizonPillUI();

      // Hero Card Net Added
      const netSign = net >= 0 ? '+' : '';
      document.getElementById('heroLabel').innerText = "Net New Business Retained";
      document.getElementById('sideNet').innerText = `${netSign}₹${net.toFixed(2)} Cr`;
      document.getElementById('sideNet').style.color = net >= 0 ? '#166534' : '#b91c1c';
      document.getElementById('sideGross').innerText = `Gross: ₹${gross.toFixed(2)} Cr`;
      document.getElementById('sideOutflow').innerText = `Outflow: ₹${outflow.toFixed(2)} Cr`;

      const retPct = gross > 0 ? ((net / gross) * 100.0) : 0;
      document.getElementById('sideRetention').innerText = `Retention: ${retPct.toFixed(1)}%`;

      // Render 3-Month Sparkbars in Hero Card
      renderHeroSparkbars(currentTrends);

      // Render 3-Month Sourcing Evolution (Lump vs SIP vs STP)
      renderSourcingEvolution(currentTrends);

      // 4 Tiles
      document.getElementById('sideSip').innerText = `₹${sip.toFixed(2)} Cr`;
      document.getElementById('sideSipCount').innerText = `${Math.round(sipCount).toLocaleString()} Debits`;
      document.getElementById('sideAvgTicket').innerText = `₹${Math.round(avgTicket).toLocaleString()}`;
      document.getElementById('sideAum').innerText = aum > 10000 ? `₹${(aum/1000).toFixed(1)}k Cr` : `₹${Math.round(aum).toLocaleString()} Cr`;
      document.getElementById('sideMfds').innerText = `${(mfds || 0).toLocaleString()} MFDs`;

      // Render 4-Tile Trends & Deltas
      renderTileTrends(currentTrends);

      // Asset Class Mix Calculation
      calculateAndRenderAssetMix(currentSchemes);

      // Render Schemes or Product Rotation depending on active tab
      if (currentSchemeTab === 'rotation') {
        renderSchemeRotation();
      } else {
        renderSchemes();
      }
    }

    function renderHeroSparkbars(trends) {
      const cont = document.getElementById('heroSparkBars');
      const deltaEl = document.getElementById('sideTrendDelta');
      const retProgEl = document.getElementById('retentionProgression');
      if (!cont || !trends || trends.length === 0) return;

      let maxAbs = 1;
      trends.forEach(t => {
        const val = Math.abs(t.net_cr || 0);
        if (val > maxAbs) maxAbs = val;
      });

      // Calculate MoM trajectory for delta pill
      if (trends.length >= 2) {
        const prev = trends[trends.length - 2].net_cr || 0;
        const curr = trends[trends.length - 1].net_cr || 0;
        if (prev !== 0) {
          const momPct = ((curr - prev) / Math.abs(prev)) * 100;
          const sign = momPct >= 0 ? '+' : '';
          if (momPct < -50) {
            deltaEl.className = 'trend-delta-pill trend-pill-neg';
            deltaEl.innerText = `▼ ${sign}${momPct.toFixed(1)}% MoM Tax Dip`;
          } else if (momPct >= 0) {
            deltaEl.className = 'trend-delta-pill trend-pill-pos';
            deltaEl.innerText = `▲ ${sign}${momPct.toFixed(1)}% MoM Growth`;
          } else {
            deltaEl.className = 'trend-delta-pill trend-pill-neg';
            deltaEl.innerText = `▼ ${sign}${momPct.toFixed(1)}% MoM`;
          }
        }
      }

      // Retention progression
      if (retProgEl) {
        retProgEl.innerHTML = trends.map(t => `${t.month.split('-')[0]}: <b>${(t.retention_pct || 0).toFixed(1)}%</b>`).join(' ➔ ');
      }

      cont.innerHTML = trends.map(t => {
        const net = t.net_cr || 0;
        const isPos = net >= 0;
        const barHeight = Math.max(4, Math.round((Math.abs(net) / maxAbs) * 26));
        const isActive = (t.month === currentMonth && currentHorizon !== 'Q1');
        const valStr = Math.abs(net) >= 1000 ? `${(net/1000).toFixed(1)}k` : `${Math.round(net)}`;

        return `
          <div class="sparkbar-col ${isActive ? 'active-col' : ''}" onclick="switchHorizon('${t.month}')" title="${t.month}: Net ${isPos?'+':''}₹${net.toFixed(2)} Cr">
            <span class="sparkbar-val" style="color:${isPos ? '#15803d' : '#b91c1c'};">${isPos?'+':''}${valStr}</span>
            <div class="sparkbar-bar ${isPos ? 'pos' : 'neg'}" style="height:${barHeight}px;"></div>
            <span class="sparkbar-lbl">${t.month.split('-')[0]}</span>
          </div>
        `;
      }).join('');
    }

    function renderSourcingEvolution(trends) {
      const cont = document.getElementById('sourcingTimeline');
      if (!cont || !trends || trends.length === 0) return;

      const formatCr = (v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : Math.round(v);

      cont.innerHTML = trends.map(t => {
        const lump = t.lumpsum_cr || 0;
        const sip = t.sip_cr || 0;
        const stp = t.stp_cr || 0;
        const tot = Math.max(1, lump + sip + stp);
        const lumpP = Math.round((lump / tot) * 100);
        const sipP = Math.round((sip / tot) * 100);
        const stpP = Math.max(0, 100 - lumpP - sipP);
        const isActive = (t.month === currentMonth && currentHorizon !== 'Q1');

        return `
          <div class="s-row ${isActive ? 'active-month' : ''}" onclick="switchHorizon('${t.month}')" style="cursor:pointer;" title="Click to inspect ${t.month}">
            <span class="s-row-lbl">${t.month}</span>
            <div class="s-row-bar-wrap">
              <div class="s-seg-lump" style="width:${lumpP}%;"></div>
              <div class="s-seg-sip" style="width:${sipP}%;"></div>
              <div class="s-seg-stp" style="width:${stpP}%;"></div>
            </div>
            <span class="s-row-vals">L: ₹${formatCr(lump)} | S: ₹${formatCr(sip)} | T: ₹${formatCr(stp)}</span>
          </div>
        `;
      }).join('');
    }

    function renderTileTrends(trends) {
      if (!trends || trends.length === 0) return;
      const formatCr = v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : Math.round(v);
      const formatAum = v => v >= 100000 ? `${(v/100000).toFixed(2)}L` : (v >= 1000 ? `${(v/1000).toFixed(1)}k` : Math.round(v));

      // SIP Tile
      const sipEl = document.getElementById('sideSipTrend');
      const sipDelta = document.getElementById('sideSipDelta');
      if (trends.length >= 2) {
        const aprSip = trends[0].sip_cr || 0;
        const junSip = trends[trends.length - 1].sip_cr || 0;
        const dPct = aprSip > 0 ? ((junSip - aprSip) / aprSip) * 100 : 0;
        if (sipDelta) sipDelta.innerText = `${dPct >= 0 ? '+' : ''}${dPct.toFixed(1)}%`;
        if (sipEl) {
          sipEl.innerText = trends.map(t => `${t.month.split('-')[0]}: ₹${formatCr(t.sip_cr)}`).join(' ➔ ');
        }
      }

      // AUM Tile
      const aumEl = document.getElementById('sideAumTrend');
      const aumDelta = document.getElementById('sideAumDelta');
      if (trends.length >= 2) {
        const aprAum = trends[0].aum_cr || 0;
        const junAum = trends[trends.length - 1].aum_cr || 0;
        const aPct = aprAum > 0 ? ((junAum - aprAum) / aprAum) * 100 : 0;
        if (aumDelta) aumDelta.innerText = `${aPct >= 0 ? '+' : ''}${aPct.toFixed(1)}%`;
        if (aumEl) {
          aumEl.innerText = trends.map(t => `${t.month.split('-')[0]}: ₹${formatAum(t.aum_cr)}`).join(' ➔ ');
        }
      }

      // Avg Ticket
      const ticketEl = document.getElementById('sideTicketTrend');
      if (ticketEl) ticketEl.innerText = `Stable across Q1`;

      // MFD Footprint
      const mfdsEl = document.getElementById('sideMfdsTrend');
      if (mfdsEl) mfdsEl.innerText = `Verified distribution`;
    }

    function switchHorizon(horizon) {
      if (horizon === 'Q1') {
        currentHorizon = 'Q1';
        updateHorizonPillUI();
        renderQ1AggregateView();
      } else {
        currentHorizon = horizon;
        currentMonth = horizon;
        const monthSel = document.getElementById('monthSelect');
        if (monthSel) monthSel.value = horizon;
        updateHorizonPillUI();
        loadMonthData();
      }
    }

    function updateHorizonPillUI() {
      const pApr = document.getElementById('pillApr');
      const pMay = document.getElementById('pillMay');
      const pJun = document.getElementById('pillJun');
      const pQ1 = document.getElementById('pillQ1');

      if (pApr) pApr.className = 'h-pill ' + (currentHorizon === 'Apr-26' ? 'active' : '');
      if (pMay) pMay.className = 'h-pill ' + (currentHorizon === 'May-26' ? 'active' : '');
      if (pJun) pJun.className = 'h-pill ' + (currentHorizon === 'Jun-26' ? 'active' : '');
      if (pQ1) pQ1.className = 'h-pill q1-tag ' + (currentHorizon === 'Q1' ? 'active' : '');
    }

    function renderQ1AggregateView() {
      if (!currentTrends || currentTrends.length === 0) return;

      let totNet = 0, totGross = 0, totOutflow = 0;
      currentTrends.forEach(t => {
        totNet += (t.net_cr || 0);
        totGross += (t.gross_cr || 0);
        totOutflow += (t.outflow_cr || 0);
      });

      const netSign = totNet >= 0 ? '+' : '';
      document.getElementById('heroLabel').innerText = "Total Q1 Capital Retained (Apr - Jun 2026)";
      document.getElementById('sideNet').innerText = `${netSign}₹${totNet.toFixed(2)} Cr`;
      document.getElementById('sideNet').style.color = totNet >= 0 ? '#166534' : '#b91c1c';
      document.getElementById('sideGross').innerText = `Total Gross: ₹${totGross.toFixed(2)} Cr`;
      document.getElementById('sideOutflow').innerText = `Total Outflow: ₹${totOutflow.toFixed(2)} Cr`;

      const q1RetPct = totGross > 0 ? ((totNet / totGross) * 100.0) : 0;
      document.getElementById('sideRetention').innerText = `Q1 Retention: ${q1RetPct.toFixed(1)}%`;

      const deltaEl = document.getElementById('sideTrendDelta');
      if (deltaEl) {
        deltaEl.className = 'trend-delta-pill trend-pill-pos';
        deltaEl.innerText = 'Q1 Combined Universe';
      }

      // Switch to rotation tab automatically
      setSchemeTab('rotation');
    }

    function setSchemeTab(tab) {
      currentSchemeTab = tab;
      document.getElementById('tabGross').className = 't-btn ' + (tab === 'gross' ? 'active' : '');
      document.getElementById('tabSip').className = 't-btn ' + (tab === 'sip' ? 'active' : '');
      document.getElementById('tabAum').className = 't-btn ' + (tab === 'aum' ? 'active' : '');
      document.getElementById('tabRotation').className = 't-btn highlight-tab ' + (tab === 'rotation' ? 'active' : '');

      const sub = document.getElementById('schemeSubtitle');
      if (tab === 'rotation') {
        if (sub) sub.innerText = 'Category Rotation & Trajectory (Q1 FY27)';
        renderSchemeRotation();
      } else {
        if (sub) sub.innerText = tab === 'gross' ? 'Top Scheme Inflows' : (tab === 'sip' ? 'Top SIP Books' : 'Closing AUM Leaders');
        calculateAndRenderAssetMix(currentSchemes);
        renderSchemes();
      }
    }

    function renderSchemeRotation() {
      const cont = document.getElementById('schemeContainer');
      if (!cont) return;

      if (!currentSchemeRotation || currentSchemeRotation.length === 0) {
        cont.innerHTML = `<div style="color:#94a3b8; font-size:12px; padding:12px; text-align:center;">No rotation data available for this selection.</div>`;
        return;
      }

      const formatVal = (v) => {
        if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(1)}k Cr`;
        return `₹${v.toFixed(1)} Cr`;
      };

      cont.innerHTML = currentSchemeRotation.slice(0, 15).map((s, idx) => {
        const apr = s.apr || {};
        const may = s.may || {};
        const jun = s.jun || {};

        const momTag = s.momentum || 'Steady Flow';
        const momClass = s.momentum_class || 'neutral';

        const netAprSign = (apr.net || 0) >= 0 ? '+' : '';
        const netMaySign = (may.net || 0) >= 0 ? '+' : '';
        const netJunSign = (jun.net || 0) >= 0 ? '+' : '';

        return `
          <div class="rotation-card">
            <div class="rot-head">
              <div>
                <div class="rot-title">${idx + 1}. ${s.scheme_type}</div>
                <div class="rot-cat">${s.asset_class}</div>
              </div>
              <span class="rot-momentum ${momClass}">${momTag}</span>
            </div>
            <div class="rot-metrics">
              <div class="rot-col">
                <div class="rot-col-m">Apr-26</div>
                <div class="rot-col-g">${formatVal(apr.gross || 0)}</div>
                <div class="rot-col-n ${(apr.net || 0) >= 0 ? 'pos' : 'neg'}">Net: ${netAprSign}${formatVal(apr.net || 0)}</div>
              </div>
              <div class="rot-col" style="border-left:1px dashed #e2e8f0; border-right:1px dashed #e2e8f0;">
                <div class="rot-col-m">May-26</div>
                <div class="rot-col-g">${formatVal(may.gross || 0)}</div>
                <div class="rot-col-n ${(may.net || 0) >= 0 ? 'pos' : 'neg'}">Net: ${netMaySign}${formatVal(may.net || 0)}</div>
              </div>
              <div class="rot-col">
                <div class="rot-col-m">Jun-26</div>
                <div class="rot-col-g">${formatVal(jun.gross || 0)}</div>
                <div class="rot-col-n ${(jun.net || 0) >= 0 ? 'pos' : 'neg'}">Net: ${netJunSign}${formatVal(jun.net || 0)}</div>
              </div>
            </div>
          </div>
        `;
      }).join('');
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
      map.setView([22.5, 79.5], 5);
      renderStatePolygons();
      if (districtLayer) map.removeLayer(districtLayer);
      renderHeatAndPins();
      loadMonthData();
    }

    async function searchPincode() {
      const pin = document.getElementById('searchInput').value.trim();
      if (pin.length === 6 && !isNaN(pin)) {
        showLoader(true);
        try {
          const res = await fetch(`/api/pincode_details?month=${currentMonth}&pincode=${pin}`);
          const data = await res.json();
          if (data.summary) {
            selectedPincode = pin;
            selectedState = data.summary.state;
            selectedDistrict = data.summary.district;
            document.getElementById('backBtn').style.display = 'block';
            document.getElementById('breadcrumbText').innerText = `All India > ${selectedState} > ${selectedDistrict} > PIN ${pin}`;

            if (data.summary.lat && data.summary.lon) {
              map.setView([data.summary.lat, data.summary.lon], 12);
            }
            renderStatePolygons();
            renderDistrictPolygons();
            await renderHeatAndPins();
            renderSidebarPincode(data.summary, data.schemes, data.monthly_trends, data.scheme_rotation);
          } else {
            alert(`PIN ${pin} not found in verified database for ${currentMonth}.`);
          }
        } catch (e) {
          console.error("Search error:", e);
        } finally {
          showLoader(false);
        }
      } else {
        alert("Please enter a valid 6-digit postal PIN code.");
      }
    }