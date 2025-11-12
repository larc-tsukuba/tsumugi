import { exportGraphAsPNG, exportGraphAsJPG, exportGraphAsCSV, exportGraphAsGraphML } from "../js/exporter.js";
import { scaleToOriginalRange, getColorForValue } from "../js/value_scaler.js";
import { removeTooltips, showTooltip } from "../js/tooltips.js";
import { calculateConnectedComponents } from "../js/components.js";
import { createSlider } from "../js/slider.js";
import { filterElementsByGenotypeAndSex } from "../js/filters.js";
import { loadJSONGz, loadJSON } from "../js/data_loader.js";
import { setupGeneSearch } from "../js/gene_searcher.js";
import { highlightDiseaseAnnotation } from "../js/highlighter.js";
import { setupPhenotypeSearch } from "../js/phenotype_searcher.js";
import { initializeCentralitySystem, recalculateCentrality } from "../js/centrality.js";

// ############################################################################
// Input handler
// ############################################################################

// REMOVE_FROM_THIS_LINE

// const elements = [
//     { data: { id: 'Nanog', label: 'Nanog', phenotype: ['hoge', 'hooo'], node_color: 50, } },
//     { data: { id: 'Pou5f1', label: 'Pou5f1', phenotype: 'fuga', node_color: 100, } },
//     { data: { id: 'Sox2', label: 'Sox2', phenotype: 'foo', node_color: 3, } },
//     { data: { source: 'Nanog', target: 'Pou5f1', phenotype: ['Foo', 'FooBar'], edge_size: 5 } },
//     { data: { source: 'Nanog', target: 'Sox2', phenotype: 'FooBar', edge_size: 1 } },
//     { data: { source: 'Sox2', target: 'Pou5f1', phenotype: 'FooBar', edge_size: 10 } },
// ];

// const map_symbol_to_id = { 'Nanog': 'MGI:97281', 'Pou5f1': 'MGI:1352748', 'Sox2': 'MGI:96217' };

// REMOVE_TO_THIS_LINE

const elements = loadJSONGz('../../data/phenotype/decreased_startle_reflex.json.gz');
const map_symbol_to_id = loadJSON("../../data/marker_symbol_accession_id.json");

// ############################################################################
// Cytoscape Elements handler
// ############################################################################

let nodeSizes = elements.filter((ele) => ele.data.node_color !== undefined).map((ele) => ele.data.node_color);
let nodeColorMin = Math.min(...nodeSizes);  // Range used for color styling
let nodeColorMax = Math.max(...nodeSizes);  // Range used for color styling

// Copy the original range so filtering can adjust independently
let nodeMin = nodeColorMin;
let nodeMax = nodeColorMax;

// ==========================================================
// Ensure at least one gene pair remains visible even at slider extremes. Issue #72
// ==========================================================

// Step 1: Map node_color to ID and assign ranking
const nodeColorMap = new Map();
elements.forEach(ele => {
    if (ele.data.node_color !== undefined && ele.data.id !== undefined) {
        nodeColorMap.set(ele.data.id, ele.data.node_color);
    }
});

// Assign ranks
const sortedNodeColors = [...new Set([...nodeColorMap.values()])].sort((a, b) => a - b);
const nodeColorToRank = new Map();
sortedNodeColors.forEach((val, idx) => {
    nodeColorToRank.set(val, idx + 1);  // Ranks start from 1
});

// Step 2: Record source/target rank sums and original values per edge
const edgeRankPairs = [];

elements.forEach(ele => {
    if (ele.data.source && ele.data.target) {
        const sourceVal = nodeColorMap.get(ele.data.source);
        const targetVal = nodeColorMap.get(ele.data.target);

        if (sourceVal !== undefined && targetVal !== undefined) {
            const sourceRank = nodeColorToRank.get(sourceVal);
            const targetRank = nodeColorToRank.get(targetVal);
            const rankSum = sourceRank + targetRank;

            edgeRankPairs.push({
                rankSum: rankSum,
                minVal: Math.min(sourceVal, targetVal),
                maxVal: Math.max(sourceVal, targetVal),
            });
        }
    }
});

// Step 3: Use the max of the lowest-ranked pair for nodeMin and the min of the highest-ranked pair for nodeMax
const minRankEdge = edgeRankPairs.reduce((a, b) => (a.rankSum < b.rankSum ? a : b));
const maxRankEdge = edgeRankPairs.reduce((a, b) => (a.rankSum > b.rankSum ? a : b));

// Update only the filtering range (preserve original values for coloring)
nodeMin = minRankEdge.maxVal;
nodeMax = maxRankEdge.minVal;

// Preserve original values for coloring and add clipped values for filtering
elements.forEach(ele => {
    if (ele.data.node_color !== undefined) {
        // Store the original value for coloring
        ele.data.original_node_color = ele.data.node_color;
        
        // Clip the value used for filtering
        if (ele.data.node_color <= nodeMin) {
            ele.data.node_color_for_filter = nodeMin;
        } else if (ele.data.node_color >= nodeMax) {
            ele.data.node_color_for_filter = nodeMax;
        } else {
            ele.data.node_color_for_filter = ele.data.node_color;
        }
    }
});


const edgeSizes = elements.filter((ele) => ele.data.edge_size !== undefined).map((ele) => ele.data.edge_size);

const edgeMin = Math.min(...edgeSizes); const edgeMax = Math.max(...edgeSizes);

function mapEdgeSizeToWidth(edgeSize) {
    if (edgeMax === edgeMin) {
        return 1.5;
    }
    const normalized = (edgeSize - edgeMin) / (edgeMax - edgeMin);
    return 0.5 + normalized * 1.5;
}

// ############################################################################
// Initialize Cytoscape
// ############################################################################

let currentLayout = "cose";

const nodeRepulsionMin = 1;
const nodeRepulsionMax = 10000;
const componentSpacingMin = 1;
const componentSpacingMax = 200;

// Use different defaults for gene symbol pages only
const isGeneSymbolPage = "loadJSONGz('../../data/phenotype/decreased_startle_reflex.json.gz')".includes("genesymbol");
const defaultNodeRepulsion = isGeneSymbolPage ? 8 : 5;

let nodeRepulsionValue = scaleToOriginalRange(
    defaultNodeRepulsion,
    nodeRepulsionMin,
    nodeRepulsionMax,
);

let componentSpacingValue = scaleToOriginalRange(
    defaultNodeRepulsion,
    componentSpacingMin,
    componentSpacingMax,
);

function getLayoutOptions() {
    const baseOptions = {
        name: currentLayout,
        nodeRepulsion: nodeRepulsionValue,
        componentSpacing: componentSpacingValue,
    };

    // Add enhanced options for COSE layout to prevent hairball effect (gene symbol pages only)
    if (currentLayout === "cose" && isGeneSymbolPage) {
        return {
            ...baseOptions,
            idealEdgeLength: 100,
            nodeOverlap: 20,
            padding: 30,
            animate: true,
            animationDuration: 500,
            gravity: -1.2,
            numIter: 1500,
            initialTemp: 200,
            coolingFactor: 0.95,
            minTemp: 1.0,
            edgeElasticity: 100,
        };
    }

    return baseOptions;
}

const cy = cytoscape({
    container: document.querySelector(".cy"),
    elements: elements,
    style: [
        {
            selector: "node",
            style: {
                label: "data(label)",
                "text-valign": "center",
                "text-halign": "center",
                "font-size": isGeneSymbolPage ? "10px" : "20px",
                width: 15,
                height: 15,
                "background-color": function (ele) {
                    const originalColor = ele.data("original_node_color") || ele.data("node_color");
                    return getColorForValue(originalColor, nodeColorMin, nodeColorMax);
                },
            },
        },
        {
            selector: "edge",
            style: {
                "curve-style": "bezier",
                "text-rotation": "autorotate",
                width: function (ele) {
                    return mapEdgeSizeToWidth(ele.data("edge_size"));
                },
            },
        },
        {
            selector: ".disease-highlight", // Class used for disease highlighting
            style: {
                "border-width": 5,
                "border-color": "#fc4c00",
            },
        },
        {
            selector: ".gene-highlight", // Class used when highlighting gene search hits
            style: {
                "color": "#006400",
                "font-weight": "bold",
            },
        },
        {
            selector: ".phenotype-highlight", // Class used for phenotype search highlighting
            style: {
                "border-width": 5,
                "border-color": "#3FA7D6",
            },
        },
    ],
    layout: getLayoutOptions(),
});


// * Expose cy globally for debugging convenience
window.cy = cy;

// * Improve Cytoscape rendering on mobile devices
function handleMobileResize() {
    if (cy) {
        // Re-render Cytoscape after layout tweaks on mobile
        setTimeout(() => {
            cy.resize();
            cy.fit();
            cy.center();
        }, 300);
    }
}

// Adjust Cytoscape once initialization finishes on mobile
setTimeout(() => {
    if (window.innerWidth <= 600) {
        cy.resize();
        cy.fit();
        cy.center();
    }
}, 500);

// Handle browser resize events
window.addEventListener('resize', handleMobileResize);

// Handle orientation changes on mobile
window.addEventListener('orientationchange', () => {
    setTimeout(handleMobileResize, 500);
});


// ############################################################################
// Control panel handler
// ############################################################################

// --------------------------------------------------------
// Network layout dropdown
// --------------------------------------------------------
document.getElementById("layout-dropdown").addEventListener("change", function () {
    currentLayout = this.value;
    cy.layout(getLayoutOptions()).run();
});

// =============================================================================
// Slider initialization and filtering helpers
// =============================================================================

// --------------------------------------------------------
// Edge size slider for Phenotypes similarity
// --------------------------------------------------------

// Initialization of the Edge size slider
const edgeSlider = document.getElementById("filter-edge-slider");
const EDGE_SLIDER_MIN = 1;
const EDGE_SLIDER_MAX = 100;
let edgeSliderRangeMin = EDGE_SLIDER_MIN;
let edgeSliderRangeMax = EDGE_SLIDER_MAX;
let edgeSliderStartMin = EDGE_SLIDER_MIN;
let edgeSliderStartMax = EDGE_SLIDER_MAX;

if (isGeneSymbolPage) {
    edgeSliderRangeMin = edgeMin;
    edgeSliderRangeMax = edgeMax === edgeMin ? edgeMin + 1 : edgeMax;
    edgeSliderStartMin = edgeSliderRangeMin;
    edgeSliderStartMax = edgeSliderRangeMax;
}

noUiSlider.create(edgeSlider, {
    start: [edgeSliderStartMin, edgeSliderStartMax],
    connect: true,
    range: { min: edgeSliderRangeMin, max: edgeSliderRangeMax },
    step: 1,
});

// Initialization of the Node color slider
const NODE_SLIDER_MIN = 1;
const NODE_SLIDER_MAX = 100;
const nodeSlider = document.getElementById("filter-node-slider");

if (nodeSlider) {
    noUiSlider.create(nodeSlider, {
        start: [NODE_SLIDER_MIN, NODE_SLIDER_MAX],
        connect: true,
        range: { min: NODE_SLIDER_MIN, max: NODE_SLIDER_MAX },
        step: 1,
    });
}


// Update the slider values when the sliders are moved
edgeSlider.noUiSlider.on("update", function (values) {
    const formattedValues = values.map((value) => Math.round(Number(value)));
    document.getElementById("edge-size-value").textContent = formattedValues.join(" - ");
    filterByNodeColorAndEdgeSize();
});

// Update the slider values when the sliders are moved
if (nodeSlider && nodeSlider.noUiSlider) {
    nodeSlider.noUiSlider.on("update", function (values) {
        const intValues = values.map((value) => Math.round(value));
        const label = document.getElementById("node-color-value");
        if (label) {
            label.textContent = intValues.join(" - ");
        }
        filterByNodeColorAndEdgeSize();
    });
}



// --------------------------------------------------------
// Modify the filter function to handle upper and lower bounds
// --------------------------------------------------------

function filterByNodeColorAndEdgeSize() {
    const hasNodeSlider = nodeSlider && nodeSlider.noUiSlider;
    const nodeSliderValues = hasNodeSlider
        ? nodeSlider.noUiSlider.get().map(Number)
        : [NODE_SLIDER_MIN, NODE_SLIDER_MAX];
    const edgeSliderValues = edgeSlider.noUiSlider.get().map(Number);

    const nodeLowerBound = Math.min(nodeMin, nodeMax);
    const nodeUpperBound = Math.max(nodeMin, nodeMax);
    const rawNodeMin = Math.min(...nodeSliderValues);
    const rawNodeMax = Math.max(...nodeSliderValues);
    let nodeMinValue = scaleToOriginalRange(rawNodeMin, nodeLowerBound, nodeUpperBound, NODE_SLIDER_MIN, NODE_SLIDER_MAX);
    let nodeMaxValue = scaleToOriginalRange(rawNodeMax, nodeLowerBound, nodeUpperBound, NODE_SLIDER_MIN, NODE_SLIDER_MAX);
    if (nodeLowerBound === nodeUpperBound) {
        nodeMinValue = nodeLowerBound;
        nodeMaxValue = nodeUpperBound;
    }

    const rawEdgeMin = Math.min(...edgeSliderValues);
    const rawEdgeMax = Math.max(...edgeSliderValues);
    let edgeMinValue = scaleToOriginalRange(rawEdgeMin, edgeMin, edgeMax, EDGE_SLIDER_MIN, EDGE_SLIDER_MAX);
    let edgeMaxValue = scaleToOriginalRange(rawEdgeMax, edgeMin, edgeMax, EDGE_SLIDER_MIN, EDGE_SLIDER_MAX);
    if (edgeMin === edgeMax) {
        edgeMinValue = edgeMin;
        edgeMaxValue = edgeMax;
    }

    // 1. Toggle node visibility based on the node_color range
    cy.nodes().forEach((node) => {
        const nodeColorForFilter = node.data("node_color_for_filter") || node.data("node_color");
        const isVisible = nodeColorForFilter >= Math.min(nodeMinValue, nodeMaxValue) && nodeColorForFilter <= Math.max(nodeMinValue, nodeMaxValue);
        node.style("display", isVisible ? "element" : "none");
    });

    // 2. Toggle edges using edge_size and shared-phenotype thresholds
    cy.edges().forEach((edge) => {
        const edgeSize = edge.data("edge_size");
        const sharedPhenotypes = edge.data("phenotype") || [];
        const sourceVisible = cy.getElementById(edge.data("source")).style("display") === "element";
        const targetVisible = cy.getElementById(edge.data("target")).style("display") === "element";

        const isVisible =
            sourceVisible &&
            targetVisible &&
            edgeSize >= Math.min(edgeMinValue, edgeMaxValue) &&
            edgeSize <= Math.max(edgeMinValue, edgeMaxValue) &&
            sharedPhenotypes.length >= 2; // Keep edges that share at least two phenotypes

        edge.style("display", isVisible ? "element" : "none");
    });

    // 3. Hide isolated nodes
    cy.nodes().forEach((node) => {
        const visibleEdges = node.connectedEdges().filter((edge) => edge.style("display") === "element");
        if (visibleEdges.length === 0) {
            node.style("display", "none");
        }
    });

    // 4. Re-run the layout
    cy.layout(getLayoutOptions()).run();

    // 5. Refresh the phenotype list so only visible genes remain
    if (window.refreshPhenotypeList) {
        window.refreshPhenotypeList();
    }
    
    // 6. Recalculate centrality for the filtered network
    if (typeof window.recalculateCentrality === 'function') {
        window.recalculateCentrality();
    }
}


// =============================================================================
// Genotype, sex, and life-stage specific filtering
// =============================================================================

let target_phenotype = "decreased startle reflex";

// Wrapper function that applies the filters
function applyFiltering() {
    filterElementsByGenotypeAndSex(elements, cy, target_phenotype, filterByNodeColorAndEdgeSize);
    // Recalculate centrality after filtering
    if (typeof window.recalculateCentrality === "function") {
        window.recalculateCentrality();
    }
}

// Trigger filtering when any form value changes
document.getElementById("genotype-filter-form").addEventListener("change", applyFiltering);
document.getElementById("sex-filter-form").addEventListener("change", applyFiltering);
document.getElementById("lifestage-filter-form").addEventListener("change", applyFiltering);

// =============================================================================	
// Highlight human disease annotations	
// =============================================================================	
highlightDiseaseAnnotation({ cy });

// ############################################################################
// Cytoscape's visualization setting
// ############################################################################

// --------------------------------------------------------
// Gene name search
// --------------------------------------------------------

setupGeneSearch({ cy });

// =============================================================================
// Phenotype highlighting (with search support)
// =============================================================================
setupPhenotypeSearch({ cy, elements });

// --------------------------------------------------------
// Slider for Font size
// --------------------------------------------------------

createSlider("font-size-slider", isGeneSymbolPage ? 10 : 20, 1, 50, 1, (intValues) => {
    document.getElementById("font-size-value").textContent = intValues;
    cy.style()
        .selector("node")
        .style("font-size", intValues + "px")
        .update();
});

// --------------------------------------------------------
// Slider for Edge width
// --------------------------------------------------------

createSlider("edge-width-slider", 5, 1, 10, 1, (intValues) => {
    document.getElementById("edge-width-value").textContent = intValues;
    cy.style()
        .selector("edge")
        .style("width", function (ele) {
            const baseWidth = mapEdgeSizeToWidth(ele.data("edge_size"));
            return baseWidth * (intValues * 0.4);
        })
        .update();
});

// --------------------------------------------------------
// Slider for Node repulsion
// --------------------------------------------------------

const layoutDropdown = document.getElementById("layout-dropdown");
const nodeRepulsionContainer = document.getElementById("node-repulsion-container");

function updateNodeRepulsionVisibility() {
    const selectedLayout = layoutDropdown.value;
    nodeRepulsionContainer.style.display = selectedLayout === "cose" ? "block" : "none";
}

updateNodeRepulsionVisibility();
layoutDropdown.addEventListener("change", updateNodeRepulsionVisibility);

createSlider("nodeRepulsion-slider", defaultNodeRepulsion, 1, 10, 1, (intValues) => {
    nodeRepulsionValue = scaleToOriginalRange(intValues, nodeRepulsionMin, nodeRepulsionMax);
    componentSpacingValue = scaleToOriginalRange(intValues, componentSpacingMin, componentSpacingMax);
    document.getElementById("node-repulsion-value").textContent = intValues;
    cy.layout(getLayoutOptions()).run();
});

// ############################################################################
// Initialize centrality system
// ############################################################################

// Initialize centrality system with dependencies
initializeCentralitySystem(cy, createSlider);

// Make recalculateCentrality available globally for use in filters
window.recalculateCentrality = recalculateCentrality;

// ############################################################################
// Tooltip handling
// ############################################################################

// Show tooltip on tap
cy.on("tap", "node, edge", function (event) {
    showTooltip(event, cy, map_symbol_to_id, target_phenotype, nodeColorMin, nodeColorMax, edgeMin, edgeMax, nodeSizes);
});

// Hide tooltip when tapping on background
cy.on("tap", function (event) {
    if (event.target === cy) {
        removeTooltips();
    }
});

// ############################################################################
// Exporter
// ############################################################################

const file_name = "TSUMUGI_decreased_startle_reflex";

// --------------------------------------------------------
// PNG Exporter
// --------------------------------------------------------

const exportPngButton = document.getElementById("export-png");
if (exportPngButton) {
    exportPngButton.addEventListener("click", function () {
        exportGraphAsPNG(cy, file_name);
    });
}

const exportJpgButton = document.getElementById("export-jpg");
if (exportJpgButton) {
    exportJpgButton.addEventListener("click", function () {
        exportGraphAsJPG(cy, file_name);
    });
}

// --------------------------------------------------------
// CSV Exporter
// --------------------------------------------------------

const exportCsvButton = document.getElementById("export-csv");
if (exportCsvButton) {
    exportCsvButton.addEventListener("click", function () {
        exportGraphAsCSV(cy, file_name);
    });
}

// --------------------------------------------------------
// GraphML Exporter (Desktop Cytoscape Compatible)
// --------------------------------------------------------

const exportGraphmlButton = document.getElementById("export-graphml");
if (exportGraphmlButton) {
    exportGraphmlButton.addEventListener("click", function () {
        exportGraphAsGraphML(cy, file_name);
    });
}

// --------------------------------------------------------
// Mobile Export buttons
// --------------------------------------------------------

const exportPngMobileButton = document.getElementById("export-png-mobile");
if (exportPngMobileButton) {
    exportPngMobileButton.addEventListener("click", function () {
        exportGraphAsPNG(cy, file_name);
    });
}

const exportJpgMobileButton = document.getElementById("export-jpg-mobile");
if (exportJpgMobileButton) {
    exportJpgMobileButton.addEventListener("click", function () {
        exportGraphAsJPG(cy, file_name);
    });
}

const exportCsvMobileButton = document.getElementById("export-csv-mobile");
if (exportCsvMobileButton) {
    exportCsvMobileButton.addEventListener("click", function () {
        exportGraphAsCSV(cy, file_name);
    });
}

const exportGraphmlMobileButton = document.getElementById("export-graphml-mobile");
if (exportGraphmlMobileButton) {
    exportGraphmlMobileButton.addEventListener("click", function () {
        exportGraphAsGraphML(cy, file_name);
    });
}
