// AmeriWater Dealer Territory Map - Using ClassBreaksRenderer
let view;
let zipLayer;
let currentView = 'primary';
let dealerColors = {};
let currentData = [...dealerData];
let homeExtent;
let selectedStates = new Set(); // Track selected states

// ArcGIS Feature Layer URL
const ZIP_LAYER_URL = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Boundaries_2023/FeatureServer/3';

// Generate distinct colors for dealers
function generateDealerColors(data = currentData) {
    dealerColors = {};
    const dealers = new Set();
    
    data.forEach(territory => {
        if (territory.primary.dealer) dealers.add(territory.primary.dealer);
        if (territory.secondary.dealer) dealers.add(territory.secondary.dealer);
        if (territory.third.dealer) dealers.add(territory.third.dealer);
    });
    
    const dealerList = Array.from(dealers).sort();
    const hueStep = 360 / dealerList.length;
    
    dealerList.forEach((dealer, index) => {
        const hue = (index * hueStep) % 360;
        const saturation = 70;
        const lightness = 50;
        dealerColors[dealer] = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    });
    
    console.log('Generated colors for', dealerList.length, 'dealers');
}

// Create ZIP3 to territory mapping
function createZip3Mapping() {
    const mapping = {};
    currentData.forEach(territory => {
        mapping[territory.zip3] = territory;
    });
    return mapping;
}

// Get dealer for ZIP3 based on current view
function getDealerForZip3(zip3) {
    const zip3Mapping = createZip3Mapping();
    const territory = zip3Mapping[zip3];
    if (!territory) return null;
    
    if (currentView === 'primary' && territory.primary.dealer) {
        return territory.primary.dealer;
    } else if (currentView === 'secondary' && territory.secondary.dealer) {
        return territory.secondary.dealer;
    } else if (currentView === 'third' && territory.third.dealer) {
        return territory.third.dealer;
    } else if (currentView === 'all' && territory.primary.dealer) {
        return territory.primary.dealer;
    }
    return null;
}

// Initialize the map
require([
    "esri/Map",
    "esri/views/MapView",
    "esri/layers/FeatureLayer",
    "esri/renderers/UniqueValueRenderer",
    "esri/symbols/SimpleFillSymbol",
    "esri/symbols/SimpleLineSymbol"
], function(Map, MapView, FeatureLayer, UniqueValueRenderer, SimpleFillSymbol, SimpleLineSymbol) {
    
    let layerView;
    
    // Generate colors
    generateDealerColors();
    
    // Create the map
    const map = new Map({
        basemap: "gray-vector"
    });
    
    // Create the view
    view = new MapView({
        container: "viewDiv",
        map: map,
        center: [-98.5795, 39.8283],
        zoom: 4,
        ui: {
            components: ["attribution"]
        },
        popup: {
            autoOpenEnabled: false
        }
    });
    
    // Store home extent
    view.when(() => {
        homeExtent = view.extent.clone();
    });
    
    // Create and add the ZIP code layer
    createZipLayer();
    
    // Hide loading screen when view is ready
    view.when(function() {
        hideLoading();
        updateLegend();
        initializeStateFilter();
        showNotification('Map loaded successfully!', 'success');
    }).catch(function(error) {
        console.error("Error loading map:", error);
        showNotification("Error loading map: " + error.message, "error");
    });
    
    // Create ZIP code layer with EFFICIENT UniqueValueRenderer (only ~63 dealers, not 85k ZIPs!)
    function createZipLayer() {
        // Create the feature layer with simple renderer first
        zipLayer = new FeatureLayer({
            url: ZIP_LAYER_URL,
            renderer: {
                type: "simple",
                symbol: new SimpleFillSymbol({
                    color: [220, 220, 220, 0.2],
                    outline: new SimpleLineSymbol({
                        color: [180, 180, 180, 0.5],
                        width: 0.5
                    })
                })
            },
            outFields: ["ZIP_CODE", "STATE", "PO_NAME", "OBJECTID"],
            opacity: 0.75,
            popupEnabled: false
        });
        
        // Add click event for custom modal
        view.on("click", function(event) {
            view.hitTest(event).then(function(response) {
                if (response.results.length) {
                    const graphic = response.results[0].graphic;
                    if (graphic.layer === zipLayer) {
                        showCustomModal(graphic.attributes);
                    }
                }
            });
        });
        
        // Add hover effect
        view.on("pointer-move", function(event) {
            view.hitTest(event).then(function(response) {
                if (response.results.length) {
                    const graphic = response.results[0].graphic;
                    if (graphic.layer === zipLayer) {
                        view.container.style.cursor = "pointer";
                    } else {
                        view.container.style.cursor = "default";
                    }
                } else {
                    view.container.style.cursor = "default";
                }
            });
        });
        
        map.add(zipLayer);
        
        // Wait for layer view and apply efficient rendering
        view.whenLayerView(zipLayer).then(function(lyrView) {
            layerView = lyrView;
            applyEfficientRendering();
            console.log('Layer created with efficient rendering approach!');
        });
    }
    
    // Apply EFFICIENT rendering using arcade expression (calculates ZIP3 on-the-fly)
    function applyEfficientRendering() {
        if (!zipLayer) return;
        
        const zip3Mapping = createZip3Mapping();
        const uniqueValueInfos = [];
        const dealerToZip3s = {};
        
        // Group ZIP3s by dealer (filtered by selected states if any)
        Object.keys(zip3Mapping).forEach(zip3 => {
            const territory = zip3Mapping[zip3];
            
            // Filter by selected states if any are selected
            if (selectedStates.size > 0 && !selectedStates.has(territory.state)) {
                return;
            }
            
            const dealer = getDealerForZip3(zip3);
            if (!dealer) return;
            
            if (!dealerToZip3s[dealer]) {
                dealerToZip3s[dealer] = [];
            }
            dealerToZip3s[dealer].push(zip3);
        });
        
        // Create unique value info for EACH DEALER (not each ZIP!)
        // Use Arcade expression to extract ZIP3 and match to dealer
        Object.keys(dealerToZip3s).forEach(dealer => {
            const color = dealerColors[dealer];
            const rgb = hslToRgb(color);
            const zip3s = dealerToZip3s[dealer];
            
            const symbol = new SimpleFillSymbol({
                color: [...rgb, 0.7],
                outline: new SimpleLineSymbol({
                    color: [100, 100, 100, 0.8],
                    width: 0.5
                })
            });
            
            // Create a single unique value for this dealer
            // The value will be matched using an Arcade expression
            uniqueValueInfos.push({
                value: dealer,
                symbol: symbol,
                label: dealer
            });
        });
        
        // Create Arcade expression that extracts ZIP3 and maps to dealer
        const arcadeExpression = createArcadeExpression(zip3Mapping);
        
        console.log(`Created renderer with ${uniqueValueInfos.length} unique values (one per dealer) - EFFICIENT!`);
        
        // Create default symbol for unmatched ZIPs
        const defaultSymbol = new SimpleFillSymbol({
            color: [220, 220, 220, 0.2],
            outline: new SimpleLineSymbol({
                color: [180, 180, 180, 0.5],
                width: 0.5
            })
        });
        
        // Create the renderer with Arcade expression
        const renderer = new UniqueValueRenderer({
            valueExpression: arcadeExpression,
            uniqueValueInfos: uniqueValueInfos,
            defaultSymbol: defaultSymbol,
            defaultLabel: "No dealer assigned"
        });
        
        zipLayer.renderer = renderer;
        
        // Apply definition expression for state filtering
        applyStateFilter();
        
        console.log('Efficient rendering applied for', currentView, 'view');
    }
    
    // Create Arcade expression that maps ZIP5 -> ZIP3 -> Dealer using WHEN statement
    function createArcadeExpression(zip3Mapping) {
        // Build WHEN conditions (more efficient than if/else chain)
        const conditions = [];
        Object.keys(zip3Mapping).forEach(zip3 => {
            const territory = zip3Mapping[zip3];
            
            // Filter by selected states if any are selected
            if (selectedStates.size > 0 && !selectedStates.has(territory.state)) {
                return;
            }
            
            const dealer = getDealerForZip3(zip3);
            if (!dealer) return;
            // Escape single quotes in dealer names
            const escapedDealer = dealer.replace(/'/g, "\\'");
            conditions.push(`  zip3 == '${zip3}', '${escapedDealer}'`);
        });
        
        // Create Arcade expression with WHEN (like SQL CASE)
        const expression = `
var zipCode = $feature.ZIP_CODE;
var zip3 = Left(zipCode, 3);

// Map ZIP3 to dealer using WHEN statement
return When(
${conditions.join(',\n')},
  null
);
`;
        
        return expression;
    }
    
    // Apply state filter using definition expression
    function applyStateFilter() {
        if (!zipLayer) return;
        
        if (selectedStates.size === 0) {
            // No filter - show all
            zipLayer.definitionExpression = null;
        } else {
            // Filter by selected states
            const stateList = Array.from(selectedStates).map(s => `'${s}'`).join(',');
            zipLayer.definitionExpression = `STATE IN (${stateList})`;
        }
    }
    
    // Initialize state filter panel
    function initializeStateFilter() {
        const stateGrid = document.getElementById('stateGrid');
        const states = new Set();
        
        // Collect all unique states from data
        currentData.forEach(territory => {
            if (territory.state) {
                states.add(territory.state);
            }
        });
        
        // Sort states alphabetically
        const sortedStates = Array.from(states).sort();
        
        // Create state chips
        stateGrid.innerHTML = '';
        sortedStates.forEach(state => {
            const chip = document.createElement('div');
            chip.className = 'state-chip';
            chip.textContent = state;
            chip.dataset.state = state;
            
            chip.addEventListener('click', function() {
                toggleStateFilter(state);
            });
            
            stateGrid.appendChild(chip);
        });
    }
    
    // Toggle state filter
    function toggleStateFilter(state) {
        if (selectedStates.has(state)) {
            selectedStates.delete(state);
        } else {
            selectedStates.add(state);
        }
        
        // Show loading overlay
        showFilterLoading();
        
        updateStateChips();
        updateLayerRenderer();
        updateLegend();
        
        // Show/hide clear button
        const clearBtn = document.getElementById('clearStateFilter');
        clearBtn.style.display = selectedStates.size > 0 ? 'block' : 'none';
        
        // Zoom to selected states (with delay to ensure layer is updated)
        if (selectedStates.size > 0) {
            setTimeout(() => {
                zoomToStates();
            }, 500);
            showNotification(`Filtered by ${selectedStates.size} state(s)`, 'success');
        } else {
            // Return to home extent if no states selected
            if (homeExtent) {
                view.goTo(homeExtent, {
                    duration: 1000,
                    easing: "ease-in-out"
                }).then(() => {
                    hideFilterLoading();
                }).catch(() => {
                    hideFilterLoading();
                });
            } else {
                hideFilterLoading();
            }
            showNotification('Filter cleared - showing all states', 'success');
        }
    }
    
    // Zoom to selected states
    function zoomToStates() {
        if (!zipLayer || selectedStates.size === 0) {
            hideFilterLoading();
            return;
        }
        
        // Build query for selected states
        const stateList = Array.from(selectedStates).map(s => `'${s}'`).join(',');
        const query = zipLayer.createQuery();
        query.where = `STATE IN (${stateList})`;
        query.returnGeometry = true;
        query.outFields = ["*"];
        
        console.log('Querying features for states:', Array.from(selectedStates));
        
        // Query features and zoom to extent
        zipLayer.queryFeatures(query).then(function(results) {
            console.log('Query returned', results.features.length, 'features');
            
            if (results.features.length > 0) {
                // Get extent of all features
                let extent = null;
                results.features.forEach(feature => {
                    if (feature.geometry && feature.geometry.extent) {
                        if (!extent) {
                            extent = feature.geometry.extent.clone();
                        } else {
                            extent = extent.union(feature.geometry.extent);
                        }
                    }
                });
                
                if (extent) {
                    console.log('Zooming to extent:', extent);
                    // Zoom to extent with padding
                    view.goTo(extent.expand(1.2), {
                        duration: 1000,
                        easing: "ease-in-out"
                    }).then(() => {
                        hideFilterLoading();
                    }).catch(function(error) {
                        console.error("Error in goTo:", error);
                        hideFilterLoading();
                    });
                } else {
                    hideFilterLoading();
                }
            } else {
                console.warn('No features found for selected states');
                hideFilterLoading();
            }
        }).catch(function(error) {
            console.error("Error querying features:", error);
            hideFilterLoading();
        });
    }
    
    // Update state chip visual states
    function updateStateChips() {
        const chips = document.querySelectorAll('.state-chip');
        chips.forEach(chip => {
            const state = chip.dataset.state;
            if (selectedStates.has(state)) {
                chip.classList.add('active');
            } else {
                chip.classList.remove('active');
            }
        });
    }
    
    // Clear all state filters
    function clearStateFilter() {
        selectedStates.clear();
        
        // Show loading overlay
        showFilterLoading();
        
        updateStateChips();
        updateLayerRenderer();
        updateLegend();
        
        const clearBtn = document.getElementById('clearStateFilter');
        clearBtn.style.display = 'none';
        
        // Return to home extent
        if (homeExtent) {
            view.goTo(homeExtent, {
                duration: 1000,
                easing: "ease-in-out"
            }).then(() => {
                hideFilterLoading();
            }).catch(() => {
                hideFilterLoading();
            });
        } else {
            hideFilterLoading();
        }
        
        showNotification('Filter cleared - showing all states', 'success');
    }
    
    // Update layer rendering when view changes
    function updateLayerRenderer() {
        if (!zipLayer || !layerView) return;
        
        applyEfficientRendering();
        console.log('Rendering updated for', currentView, 'view');
    }
    
    // Show custom modal
    function showCustomModal(attributes) {
        const zip5 = attributes.ZIP_CODE;
        const zip3 = zip5 ? zip5.substring(0, 3) : null;
        const zip3Mapping = createZip3Mapping();
        const territory = zip3 ? zip3Mapping[zip3] : null;
        
        const modal = document.getElementById('customModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalBody = document.getElementById('modalBody');
        
        modalTitle.innerHTML = `<i class="fas fa-map-marker-alt"></i> ZIP Code: ${zip5}`;
        
        if (!territory) {
            modalBody.innerHTML = `
                <div class="info-row">
                    <span class="info-label">State:</span>
                    <span class="info-value">${attributes.STATE || 'N/A'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Post Office:</span>
                    <span class="info-value">${attributes.PO_NAME || 'N/A'}</span>
                </div>
                <p style="color: var(--text-gray); margin-top: 20px; text-align: center; font-style: italic;">
                    No dealer assigned to this territory
                </p>
            `;
        } else {
            let content = `
                <div class="info-row">
                    <span class="info-label">State:</span>
                    <span class="info-value">${territory.state}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">ZIP3 Territory:</span>
                    <span class="info-value">${territory.zip3}xx</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Post Office:</span>
                    <span class="info-value">${attributes.PO_NAME || 'N/A'}</span>
                </div>
            `;
            
            if (territory.primary.dealer) {
                const dealerColor = dealerColors[territory.primary.dealer];
                content += `
                    <div class="dealer-card" style="border-left-color: ${dealerColor}">
                        <div class="dealer-card-title">
                            <i class="fas fa-building"></i> Primary Dealer
                        </div>
                        <div class="dealer-card-name">${territory.primary.dealer}</div>
                        <div class="dealer-card-account">Account: ${territory.primary.account || 'N/A'}</div>
                    </div>
                `;
            }
            
            if (territory.secondary.dealer) {
                const dealerColor = dealerColors[territory.secondary.dealer];
                content += `
                    <div class="dealer-card secondary" style="border-left-color: ${dealerColor}">
                        <div class="dealer-card-title">
                            <i class="fas fa-sync-alt"></i> Secondary Dealer
                        </div>
                        <div class="dealer-card-name">${territory.secondary.dealer}</div>
                        <div class="dealer-card-account">Account: ${territory.secondary.account || 'N/A'}</div>
                    </div>
                `;
            }
            
            if (territory.third.dealer) {
                const dealerColor = dealerColors[territory.third.dealer];
                content += `
                    <div class="dealer-card third" style="border-left-color: ${dealerColor}">
                        <div class="dealer-card-title">
                            <i class="fas fa-medal"></i> Third Dealer
                        </div>
                        <div class="dealer-card-name">${territory.third.dealer}</div>
                        <div class="dealer-card-account">Account: ${territory.third.account || 'N/A'}</div>
                    </div>
                `;
            }
            
            modalBody.innerHTML = content;
        }
        
        modal.style.display = 'flex';
    }
    
    // Layer control functions
    window.showPrimaryLayer = function() {
        currentView = 'primary';
        updateLayerRenderer();
        updateButtonStates('btnPrimary');
        showNotification('Showing Primary Dealers', 'success');
    };
    
    window.showSecondaryLayer = function() {
        currentView = 'secondary';
        updateLayerRenderer();
        updateButtonStates('btnSecondary');
        showNotification('Showing Secondary Dealers', 'success');
    };
    
    window.showThirdLayer = function() {
        currentView = 'third';
        updateLayerRenderer();
        updateButtonStates('btnThird');
        showNotification('Showing Third Dealers', 'success');
    };
    
    window.showAllLayers = function() {
        currentView = 'all';
        updateLayerRenderer();
        updateButtonStates('btnShowAll');
        showNotification('Showing All Layers', 'success');
    };
    
    // CSV Upload Handler
    window.handleCSVUpload = function(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        showNotification('Processing CSV file...', 'success');
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const csv = e.target.result;
                const newData = parseCSV(csv);
                
                if (newData.length === 0) {
                    throw new Error('No valid data found in CSV');
                }
                
                currentData = newData;
                generateDealerColors(newData);
                updateLayerRenderer();
                updateLegend();
                
                showNotification(`Successfully loaded ${newData.length} territories!`, 'success');
                event.target.value = '';
                
            } catch (error) {
                showNotification('Error processing CSV: ' + error.message, 'error');
                console.error('CSV parsing error:', error);
            }
        };
        
        reader.readAsText(file);
    };
    
    // Custom control buttons
    document.getElementById('fullscreenBtn').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    });
    
    document.getElementById('zoomInBtn').addEventListener('click', () => {
        view.zoom += 1;
    });
    
    document.getElementById('zoomOutBtn').addEventListener('click', () => {
        view.zoom -= 1;
    });
    
    document.getElementById('homeBtn').addEventListener('click', () => {
        if (homeExtent) {
            view.goTo(homeExtent, {
                duration: 1000,
                easing: "ease-in-out"
            });
        }
    });
});

// Helper function to convert HSL to RGB
function hslToRgb(hsl) {
    const match = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!match) return [128, 128, 128];
    
    let h = parseInt(match[1]) / 360;
    let s = parseInt(match[2]) / 100;
    let l = parseInt(match[3]) / 100;
    
    let r, g, b;
    
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Parse CSV file
function parseCSV(csv) {
    const lines = csv.split('\n');
    const territories = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const fields = [];
        let current = '';
        let inQuotes = false;
        
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                fields.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        fields.push(current.trim());
        
        if (fields.length < 4) continue;
        
        const zip3 = fields[0];
        if (!zip3) continue;
        
        const territory = {
            zip3: zip3,
            state: fields[1] || '',
            primary: {
                dealer: fields[2] || null,
                account: fields[3] || null
            },
            secondary: {
                dealer: fields[4] || null,
                account: fields[5] || null
            },
            third: {
                dealer: fields[6] || null,
                account: fields[7] || null
            }
        };
        
        territories.push(territory);
    }
    
    return territories;
}

// Update legend with matching colors
function updateLegend() {
    const legendContent = document.getElementById('legendContent');
    let html = '';
    
    // Get dealers that match current view and state filter
    const zip3Mapping = createZip3Mapping();
    const visibleDealers = new Set();
    
    Object.keys(zip3Mapping).forEach(zip3 => {
        const territory = zip3Mapping[zip3];
        
        // Filter by selected states if any are selected
        if (selectedStates.size > 0 && !selectedStates.has(territory.state)) {
            return;
        }
        
        const dealer = getDealerForZip3(zip3);
        if (dealer) {
            visibleDealers.add(dealer);
        }
    });
    
    // Sort dealers alphabetically
    const dealers = Array.from(visibleDealers).sort();
    
    dealers.forEach((dealer) => {
        const color = dealerColors[dealer];
        html += `
            <div class="legend-item">
                <div class="legend-color" style="background-color: ${color}"></div>
                <div class="legend-text">${dealer}</div>
            </div>
        `;
    });
    
    if (dealers.length === 0) {
        html = '<div class="legend-item"><div class="legend-text" style="color: var(--text-gray); font-style: italic;">No dealers in selected state(s)</div></div>';
    }
    
    legendContent.innerHTML = html;
}

// Update button states
function updateButtonStates(activeId) {
    ['btnPrimary', 'btnSecondary', 'btnThird', 'btnShowAll'].forEach(id => {
        const btn = document.getElementById(id);
        if (id === activeId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Show/hide loading
function hideLoading() {
    const loading = document.getElementById('loadingScreen');
    if (loading) {
        loading.classList.add('fade-out');
        setTimeout(() => {
            loading.style.display = 'none';
        }, 300);
    }
}

// Show/hide filter loading overlay
function showFilterLoading() {
    const overlay = document.getElementById('filterLoadingOverlay');
    if (overlay) {
        overlay.classList.add('active');
    }
}

function hideFilterLoading() {
    const overlay = document.getElementById('filterLoadingOverlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

// Show notification
function showNotification(message, type) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';
    
    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

// Modal close handlers
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('btnPrimary').addEventListener('click', () => window.showPrimaryLayer());
    document.getElementById('btnSecondary').addEventListener('click', () => window.showSecondaryLayer());
    document.getElementById('btnThird').addEventListener('click', () => window.showThirdLayer());
    document.getElementById('btnShowAll').addEventListener('click', () => window.showAllLayers());
    document.getElementById('csvUpload').addEventListener('change', (e) => window.handleCSVUpload(e));
    
    document.getElementById('modalClose').addEventListener('click', () => {
        document.getElementById('customModal').style.display = 'none';
    });
    
    document.getElementById('customModal').addEventListener('click', (e) => {
        if (e.target.id === 'customModal') {
            document.getElementById('customModal').style.display = 'none';
        }
    });
    
    document.getElementById('clearStateFilter').addEventListener('click', () => {
        clearStateFilter();
    });
});
