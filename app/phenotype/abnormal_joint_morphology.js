import { exportGraphAsPNG, exportGraphAsCSV } from '../js/exporter.js';
import { scaleToOriginalRange, scaleValue, getColorForValue } from '../js/value_scaler.js';
import { removeTooltips, showTooltip } from '../js/tooltips.js';
import { calculateConnectedComponents } from '../js/components.js';
import { createSlider } from '../js/slider.js';
import { filterElementsByGenotypeAndSex } from '../js/filters.js';

// ############################################################################
// Input handler
// ############################################################################

// REMOVE_FROM_THIS_LINE

// const elements = [
//     { data: { id: 'Nanog', label: 'Nanog', annotation: ['hoge', 'hooo'], node_color: 50, } },
//     { data: { id: 'Pou5f1', label: 'Pou5f1', annotation: 'fuga', node_color: 100, } },
//     { data: { id: 'Sox2', label: 'Sox2', annotation: 'foo', node_color: 3, } },
//     { data: { source: 'Nanog', target: 'Pou5f1', annotation: ['Foo', 'FooBar'], edge_size: 5 } },
//     { data: { source: 'Nanog', target: 'Sox2', annotation: 'FooBar', edge_size: 1 } },
//     { data: { source: 'Sox2', target: 'Pou5f1', annotation: 'FooBar', edge_size: 10 } },
// ];

// const map_symbol_to_id = { 'Nanog': 'MGI:97281', 'Pou5f1': 'MGI:1352748', 'Sox2': 'MGI:96217' };

// REMOVE_TO_THIS_LINE

const target_phenotype = 'abnormal_joint_morphology'.replace(/_/g, " ");

const elements = (function () {
    const req = new XMLHttpRequest();
    let result = null;

    try {
        req.open("GET", "../../data/phenotype/abnormal_joint_morphology.json.gz", false);

        req.overrideMimeType("text/plain; charset=x-user-defined"); // バイナリデータとして扱うための設定
        req.send(null);

        if (req.status === 200) {
            // gzipデータをUint8Arrayに変換
            const compressedData = new Uint8Array(
                req.responseText.split("").map(c => c.charCodeAt(0) & 0xff)
            );
            // pakoでデコード
            const decompressedData = pako.ungzip(compressedData, { to: "string" });
            result = JSON.parse(decompressedData);
        } else {
            console.error("HTTP error!! status:", req.status);
        }
    } catch (error) {
        console.error("Failed to load or decode JSON.gz:", error);
    }

    return result;
})();

const map_symbol_to_id = (function () {
    const req = new XMLHttpRequest();
    let result = null;
    req.onreadystatechange = function () {
        if (req.readyState === 4 && req.status === 200) {
            result = JSON.parse(req.responseText);
        }
    };
    req.open("GET", "../../data/marker_symbol_accession_id.json", false);

    req.send(null);
    return result;
})();


// ############################################################################
// 遺伝型・正特異的フィルタリング関数
// ############################################################################

// フィルターフォームの取得
const filterGenotypeForm = document.getElementById('genotype-filter-form');
const filterSexForm = document.getElementById('sex-filter-form');

// フォーム変更時にフィルタリング関数を実行
filterGenotypeForm.addEventListener('change', filterElementsByGenotypeAndSex);
filterSexForm.addEventListener('change', filterElementsByGenotypeAndSex);


// ############################################################################
// Cytoscape Elements handler
// ############################################################################

const nodeSizes = elements.filter(ele => ele.data.node_color !== undefined).map(ele => ele.data.node_color);
const edgeSizes = elements.filter(ele => ele.data.edge_size !== undefined).map(ele => ele.data.edge_size);

const nodeMin = Math.min(...nodeSizes);
const nodeMax = Math.max(...nodeSizes);
const edgeMin = Math.min(...edgeSizes);
const edgeMax = Math.max(...edgeSizes);


function getLayoutOptions() {
    return {
        name: currentLayout,
        nodeRepulsion: nodeRepulsionValue,
        componentSpacing: componentSpacingValue
    };
}

let currentLayout = 'cose';

const nodeRepulsionMin = 1;
const nodeRepulsionMax = 10000;
const componentSpacingMin = 1;
const componentSpacingMax = 200;

let nodeRepulsionValue = scaleToOriginalRange(
    parseFloat(document.getElementById('nodeRepulsion-slider').value),
    nodeRepulsionMin,
    nodeRepulsionMax
);

let componentSpacingValue = scaleToOriginalRange(
    parseFloat(document.getElementById('nodeRepulsion-slider').value),
    componentSpacingMin,
    componentSpacingMax
);

const cy = cytoscape({
    container: document.querySelector('.cy'),
    elements: elements,
    style: [
        {
            selector: 'node',
            style: {
                'label': 'data(label)',
                'text-valign': 'center',
                'text-halign': 'center',
                'font-size': '20px',
                'width': 15,
                'height': 15,
                'background-color': function (ele) {
                    const color_value = scaleValue(ele.data('node_color'), nodeMin, nodeMax, 1, 10);
                    return getColorForValue(color_value);
                }
            }
        },
        {
            selector: 'edge',
            style: {
                'curve-style': 'bezier',
                'text-rotation': 'autorotate',
                'width': function (ele) {
                    return scaleValue(ele.data('edge_size'), edgeMin, edgeMax, 0.5, 2);
                }
            }
        }
    ],
    layout: getLayoutOptions()
});

// レイアウト変更後にイベントリスナーを設定
cy.on('layoutstop', function () {
    calculateConnectedComponents(cy);
});

// ############################################################################
// Control panel handler
// ############################################################################

// --------------------------------------------------------
// Network layout dropdown
// --------------------------------------------------------
document.getElementById('layout-dropdown').addEventListener('change', function () {
    currentLayout = this.value;
    cy.layout({ name: currentLayout }).run();
});

// --------------------------------------------------------
// Initialization and Update of the Slider for Phenotypes similarity
// --------------------------------------------------------
const edgeSlider = document.getElementById('filter-edge-slider');
noUiSlider.create(edgeSlider, {
    start: [1, 10],
    connect: true,
    range: {
        'min': 1,
        'max': 10
    },
    step: 1
});


// REMOVE_FROM_THIS_LINE

// --------------------------------------------------------
// Initialization of the Slider for Phenotypes severity
// --------------------------------------------------------

const nodeSlider = document.getElementById('filter-node-slider');
noUiSlider.create(nodeSlider, {
    start: [1, 10],
    connect: true,
    range: {
        'min': 1,
        'max': 10
    },
    step: 1
});
// REMOVE_TO_THIS_LINE


// --------------------------------------------------------
// Modify the filter function to handle upper and lower bounds
// --------------------------------------------------------

let nodeSliderValues = [1, 10];

function filterElements() {
    // REMOVE_FROM_THIS_LINE
    nodeSliderValues = nodeSlider.noUiSlider.get().map(parseFloat);
    // REMOVE_TO_THIS_LINE
    const edgeSliderValues = edgeSlider.noUiSlider.get().map(parseFloat);

    const nodeMinValue = scaleToOriginalRange(nodeSliderValues[0], nodeMin, nodeMax);
    const nodeMaxValue = scaleToOriginalRange(nodeSliderValues[1], nodeMin, nodeMax);
    const edgeMinValue = scaleToOriginalRange(edgeSliderValues[0], edgeMin, edgeMax);
    const edgeMaxValue = scaleToOriginalRange(edgeSliderValues[1], edgeMin, edgeMax);

    // Filter nodes based on color
    cy.nodes().forEach(function (node) {
        const nodeColor = node.data('node_color');
        node.style('display', (nodeColor >= nodeMinValue && nodeColor <= nodeMaxValue) ? 'element' : 'none');
    });

    // Filter edges based on size
    cy.edges().forEach(function (edge) {
        const edgeSize = edge.data('edge_size');
        const sourceNode = cy.getElementById(edge.data('source'));
        const targetNode = cy.getElementById(edge.data('target'));

        if (sourceNode.style('display') === 'element' && targetNode.style('display') === 'element' &&
            edgeSize >= edgeMinValue && edgeSize <= edgeMaxValue) {
            edge.style('display', 'element');
        } else {
            edge.style('display', 'none');
        }
    });

    // After filtering, remove nodes with no connected visible edges
    cy.nodes().forEach(function (node) {
        const connectedEdges = node.connectedEdges().filter(edge => edge.style('display') === 'element');
        if (connectedEdges.length === 0) {
            node.style('display', 'none');  // Hide node if no connected edges
        }
    });

    // Reapply layout after filtering
    cy.layout(getLayoutOptions()).run();
}

// --------------------------------------------------------
// Update of the Slider
// --------------------------------------------------------

edgeSlider.noUiSlider.on('update', function (values) {
    const intValues = values.map(value => Math.round(value));
    document.getElementById('edge-size-value').textContent = intValues.join(' - ');
    filterElements();
});


// REMOVE_FROM_THIS_LINE
nodeSlider.noUiSlider.on('update', function (values) {
    const intValues = values.map(value => Math.round(value));
    document.getElementById('node-color-value').textContent = intValues.join(' - ');
    filterElements();
});
// REMOVE_TO_THIS_LINE


// ############################################################################
// Cytoscape's visualization setting
// ############################################################################

// --------------------------------------------------------
// Slider for Font size
// --------------------------------------------------------

createSlider('font-size-slider', 20, 1, 50, 1, (intValues) => {
    document.getElementById('font-size-value').textContent = intValues;
    cy.style().selector('node').style('font-size', intValues + 'px').update();
});

// --------------------------------------------------------
// Slider for Edge width
// --------------------------------------------------------

createSlider('edge-width-slider', 5, 1, 10, 1, (intValues) => {
    document.getElementById('edge-width-value').textContent = intValues;
    cy.style().selector('edge').style('width', function (ele) {
        return scaleValue(ele.data('edge_size'), edgeMin, edgeMax, 0.5, 2) * intValues;
    }).update();
});


// --------------------------------------------------------
// Slider for Node repulsion
// --------------------------------------------------------

createSlider('nodeRepulsion-slider', 5, 1, 10, 1, (intValues) => {
    nodeRepulsionValue = scaleToOriginalRange(intValues, nodeRepulsionMin, nodeRepulsionMax);
    componentSpacingValue = scaleToOriginalRange(intValues, componentSpacingMin, componentSpacingMax);
    document.getElementById('node-repulsion-value').textContent = intValues;
    cy.layout(getLayoutOptions()).run();
});


// ############################################################################
// Tooltip handling
// ############################################################################

// Show tooltip on tap
cy.on('tap', 'node, edge', function (event) {
    showTooltip(event, cy, map_symbol_to_id);
});


// Hide tooltip when tapping on background
cy.on('tap', function (event) {
    if (event.target === cy) {
        removeTooltips();
    }
});

// ############################################################################
// Exporter
// ############################################################################

const file_name = 'TSUMUGI_abnormal_joint_morphology';

// --------------------------------------------------------
// PNG Exporter
// --------------------------------------------------------

document.getElementById('export-png').addEventListener('click', function () {
    exportGraphAsPNG(cy, file_name);
});


// --------------------------------------------------------
// CSV Exporter
// --------------------------------------------------------

document.getElementById('export-csv').addEventListener('click', function () {
    exportGraphAsCSV(cy, file_name);
});
