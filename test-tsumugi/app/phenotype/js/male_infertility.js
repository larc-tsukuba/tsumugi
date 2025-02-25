// ############################################################################
// Input handler
// ############################################################################

// const elements = [
//     { data: { id: 'Nanog', label: 'Nanog', annotation: ['hoge', 'hooo'], node_color: 50, } },
//     { data: { id: 'Pou5f1', label: 'Pou5f1', annotation: 'fuga', node_color: 100, } },
//     { data: { id: 'Sox2', label: 'Sox2', annotation: 'foo', node_color: 3, } },
//     { data: { source: 'Nanog', target: 'Pou5f1', annotation: ['Foo', 'FooBar'], edge_size: 5 } },
//     { data: { source: 'Nanog', target: 'Sox2', annotation: 'FooBar', edge_size: 1 } },
//     { data: { source: 'Sox2', target: 'Pou5f1', annotation: 'FooBar', edge_size: 10 } },
// ];

// const map_symbol_to_id = { 'Nanog': 'MGI:97281', 'Pou5f1': 'MGI:1352748', 'Sox2': 'MGI:96217' };

const target_phenotype = 'male_infertility'.replace(/_/g, " ");

async function fetchJsonGz(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        // バイナリデータとして取得
        const compressedData = new Uint8Array(await response.arrayBuffer());
        // pakoでデコード
        const decompressedData = pako.ungzip(compressedData, { to: "string" });

        return JSON.parse(decompressedData);
    } catch (error) {
        console.error(`Failed to fetch or decode JSON.gz from ${url}:`, error);
        return null;
    }
}

async function fetchJson(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Failed to fetch JSON from ${url}:`, error);
        return null;
    }
}

// JSONデータを非同期で取得
async function loadData() {
    const elements = await fetchJsonGz("../../data/phenotype/male_infertility.json.gz");
    const map_symbol_to_id = await fetchJson("../../data/marker_symbol_accession_id.json");

    return { elements, map_symbol_to_id };
}

// 使用するデータを取得して初期化
loadData().then(({ elements, map_symbol_to_id }) => {
    if (!elements || !map_symbol_to_id) {
        console.error("Failed to load data.");
        return;
    }

    // 取得したデータをグローバル変数に設定
    window.elements = elements;
    window.map_symbol_to_id = map_symbol_to_id;

    initializeCytoscape();
    setupEventListeners();
});


// Cytoscape の初期化関数
function initializeCytoscape() {
    if (!window.elements) {
        console.error("Cytoscape initialization failed: window.elements is undefined.");
        return;
    }


    // `window.elements` がロードされた後に `nodeSizes` と `edgeSizes` を計算
    const nodeSizes = window.elements
        .filter(ele => ele.data.node_color !== undefined)
        .map(ele => ele.data.node_color);

    const edgeSizes = window.elements
        .filter(ele => ele.data.edge_size !== undefined)
        .map(ele => ele.data.edge_size);

    const nodeMin = nodeSizes.length ? Math.min(...nodeSizes) : 0;
    const nodeMax = nodeSizes.length ? Math.max(...nodeSizes) : 1;
    const edgeMin = edgeSizes.length ? Math.min(...edgeSizes) : 0;
    const edgeMax = edgeSizes.length ? Math.max(...edgeSizes) : 1;

    const cy = cytoscape({
        container: document.querySelector('.cy'),
        elements: window.elements,
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

    // グローバル変数に保存
    window.cy = cy;
    window.nodeMin = nodeMin;
    window.nodeMax = nodeMax;
    window.edgeMin = edgeMin;
    window.edgeMax = edgeMax;
}

function setupEventListeners() {
    const filterGenotypeForm = document.getElementById('genotype-filter-form');
    const filterSexForm = document.getElementById('sex-filter-form');

    filterGenotypeForm.addEventListener('change', filterElementsByGenotypeAndSex);
    filterSexForm.addEventListener('change', filterElementsByGenotypeAndSex);
}


// ############################################################################
// 遺伝型・正特異的フィルタリング関数
// ############################################################################

// フィルタリング関数（遺伝型 + 性別）
function filterElementsByGenotypeAndSex() {
    if (!window.elements) return; // `window.elements` がロードされる前に呼ばれないようにする

    const checkedGenotypes = Array.from(document.querySelectorAll('#genotype-filter-form input:checked'))
        .map(input => input.value);
    const checkedSexs = Array.from(document.querySelectorAll('#sex-filter-form input:checked'))
        .map(input => input.value);

    let targetElements = [...window.elements];

    if (!(checkedSexs.includes("Female") && checkedSexs.includes("Male"))) {
        targetElements = targetElements.map(item => {
            if (item.data.annotation) {
                const filteredAnnotations = item.data.annotation.filter(annotation =>
                    checkedSexs.some(sex => annotation.includes(`${sex}`))
                );
                return { ...item, data: { ...item.data, annotation: filteredAnnotations } };
            }
            return item;
        }).filter(item => item.data.annotation && item.data.annotation.length > 0);
    }

    let filteredElements = targetElements.map(item => {
        if (item.data.annotation) {
            const filteredAnnotations = item.data.annotation.filter(annotation =>
                checkedGenotypes.some(genotype => annotation.includes(`${genotype}`))
            );
            return { ...item, data: { ...item.data, annotation: filteredAnnotations } };
        }
        return item;
    }).filter(item => item.data.annotation && item.data.annotation.length > 0);

    filteredElements = filteredElements.filter(item =>
        item.data.annotation.some(annotation => annotation.includes(target_phenotype))
    ).filter(item => item.data.annotation && item.data.annotation.length > 2);

    // Cytoscape のデータを更新
    window.cy.elements().remove();
    window.cy.add(filteredElements);
    filterElements();
}

// フィルターフォームの取得
const filterGenotypeForm = document.getElementById('genotype-filter-form');
const filterSexForm = document.getElementById('sex-filter-form');

// フォーム変更時にフィルタリング関数を実行
filterGenotypeForm.addEventListener('change', filterElementsByGenotypeAndSex);
filterSexForm.addEventListener('change', filterElementsByGenotypeAndSex);


// ############################################################################
// Normalize node color and edge sizes
// ############################################################################

function scaleToOriginalRange(value, minValue, maxValue) {
    return minValue + (value - 1) * (maxValue - minValue) / 9;
}

function scaleValue(value, minValue, maxValue, minScale, maxScale) {
    // スケール範囲をminScaleとmaxScaleに合わせて変換
    if (minValue == maxValue) {
        return (maxScale + minScale) / 2;
    }
    return minScale + (value - minValue) * (maxScale - minScale) / (maxValue - minValue);
}

function getColorForValue(value) {
    // value を1-10の範囲から0-1の範囲に変換
    const ratio = (value - 1) / (10 - 1);
    const r1 = 248, g1 = 229, b1 = 140; // Light Yellow #F8E58C
    const r2 = 255, g2 = 140, b2 = 0;   // Orange #FF8C00

    const r = Math.round(r1 + (r2 - r1) * ratio);
    const g = Math.round(g1 + (g2 - g1) * ratio);
    const b = Math.round(b1 + (b2 - b1) * ratio);

    return `rgb(${r}, ${g}, ${b})`;
}

// ############################################################################
// Cytoscape Elements handler
// ############################################################################

let currentLayout = 'cose';

const nodeRepulsionMin = 1;
const nodeRepulsionMax = 10000;
let nodeRepulsionValue = scaleToOriginalRange(
    parseFloat(document.getElementById('nodeRepulsion-slider').value),
    nodeRepulsionMin,
    nodeRepulsionMax
);

const componentSpacingMin = 1;
const componentSpacingMax = 200;
let componentSpacingValue = scaleToOriginalRange(
    parseFloat(this.value),
    componentSpacingMin,
    componentSpacingMax
);

function getLayoutOptions() {
    return {
        name: currentLayout,
        nodeRepulsion: nodeRepulsionValue,
        componentSpacing: componentSpacingValue
    };
}


// レイアウトが変更されるか、フィルタリングが実行された際に連結成分を計算する関数
function calculateConnectedComponents() {
    // 表示されている要素のみを取得
    const visibleElements = cy.elements(':visible');

    // 可視状態の要素で連結成分を計算
    const connectedComponents = visibleElements.components();

    let connected_component = connectedComponents.map(component => {
        let componentObject = {};

        // ノードを処理
        component.nodes().forEach(node => {
            const nodeLabel = node.data('label');
            const nodeAnnotations = Array.isArray(node.data('annotation'))
                ? node.data('annotation')
                : [node.data('annotation')]; // annotation が配列でない場合も考慮

            // ノード名をキー、アノテーションを値とするオブジェクトを作成
            componentObject[nodeLabel] = nodeAnnotations;
        });

        return componentObject;
    });

    // 結果をログに出力（デバッグ用）
    // console.log('Connected Components (Formatted):', connected_component);

    // 必要に応じて connected_component を他の場所で利用可能にする
    return connected_component;
}

// レイアウト変更後にイベントリスナーを設定
cy.on('layoutstop', function () {
    calculateConnectedComponents();
});


// ############################################################################
// Cytoscape's Tooltip handler
// ############################################################################

// Utility function: Create a tooltip element
function createTooltipElement(text, position) {
    const tooltip = document.createElement('div');
    tooltip.classList.add('cy-tooltip');
    tooltip.innerHTML = text;
    tooltip.style.position = 'absolute';
    tooltip.style.left = (position.x + 10) + 'px';  // Position to the right of the element
    tooltip.style.top = (position.y + 10) + 'px';   // Position slightly below the element
    tooltip.style.padding = '5px';
    tooltip.style.background = 'white';
    tooltip.style.border = '1px solid #ccc';
    tooltip.style.borderRadius = '5px';
    tooltip.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    tooltip.style.zIndex = '1000';
    tooltip.style.cursor = 'move';  // Show the move cursor
    tooltip.style.userSelect = 'text';  // Allow text selection
    return tooltip;
}

// Utility function: Add drag functionality to a tooltip
function enableTooltipDrag(tooltip) {
    let isDragging = false;
    let offset = { x: 0, y: 0 };

    tooltip.addEventListener('mousedown', function (e) {
        e.stopPropagation(); // Prevent Cytoscape from receiving this event
        isDragging = true;
        const rect = tooltip.getBoundingClientRect();
        offset.x = e.clientX - rect.left;
        offset.y = e.clientY - rect.top;
        tooltip.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', function (e) {
        if (isDragging) {
            const containerRect = document.querySelector('.cy').getBoundingClientRect();
            tooltip.style.left = (e.clientX - offset.x - containerRect.left) + 'px';
            tooltip.style.top = (e.clientY - offset.y - containerRect.top) + 'px';
        }
    });

    document.addEventListener('mouseup', function () {
        isDragging = false;
        tooltip.style.cursor = 'move';
    });
}

// Function: Generate tooltip text for a node
function getNodeTooltipText(data) {
    const annotations = Array.isArray(data.annotation)
        ? data.annotation.map(anno => '・ ' + anno).join('<br>')
        : '・ ' + data.annotation;

    const geneId = window.map_symbol_to_id?.[data.label] ?? null;
    const url_impc = geneId ? `https://www.mousephenotype.org/data/genes/${geneId}` : "#"; // データがない場合はリンクを無効化
    // const url_impc = `https://www.mousephenotype.org/data/genes/${window.map_symbol_to_id[data.label]}`;
    return `<b>Phenotypes of <a href="${url_impc}" target="_blank">${data.label} KO mice</a></b><br>` + annotations;
}

// Function: Generate tooltip text for an edge
function getEdgeTooltipText(data) {
    const sourceNode = cy.getElementById(data.source).data('label');
    const targetNode = cy.getElementById(data.target).data('label');
    const annotations = Array.isArray(data.annotation)
        ? data.annotation.map(anno => '・ ' + anno).join('<br>')
        : '・ ' + data.annotation;

    return `<b>Shared phenotypes of ${sourceNode} and ${targetNode} KOs</b><br>` + annotations;
}

// Function: Calculate the midpoint of an edge
function getEdgeMidpoint(sourceId, targetId) {
    const sourcePos = cy.getElementById(sourceId).renderedPosition();
    const targetPos = cy.getElementById(targetId).renderedPosition();
    return {
        x: (sourcePos.x + targetPos.x) / 2,
        y: (sourcePos.y + targetPos.y) / 2
    };
}

// Main Cytoscape event listener
cy.on('tap', 'node, edge', function (event) {
    const data = event.target.data();
    let tooltipText = '';
    let pos;

    // Remove any existing tooltips
    document.querySelectorAll('.cy-tooltip').forEach(el => el.remove());

    if (event.target.isNode()) {
        tooltipText = getNodeTooltipText(data);
        pos = event.target.renderedPosition();
    } else if (event.target.isEdge()) {
        tooltipText = getEdgeTooltipText(data);
        pos = getEdgeMidpoint(data.source, data.target);
    }

    // Create and display tooltip
    const tooltip = createTooltipElement(tooltipText, pos);
    document.querySelector('.cy').appendChild(tooltip);

    // Enable drag functionality for the tooltip
    enableTooltipDrag(tooltip);
});


// Hide tooltip when tapping on background
cy.on('tap', function (event) {
    // If the clicked element is not a node or edge, remove the tooltip
    if (event.target === cy) {
        document.querySelectorAll('.cy-tooltip').forEach(function (el) {
            el.remove();
        });
    }
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




// --------------------------------------------------------
// Modify the filter function to handle upper and lower bounds
// --------------------------------------------------------

let nodeSliderValues = [1, 10];

function filterElements() {
    const edgeSliderValues = edgeSlider.noUiSlider.get().map(parseFloat);

    const nodeMinValue = scaleToOriginalRange(nodeSliderValues[0], window.nodeMin, window.nodeMax);
    const nodeMaxValue = scaleToOriginalRange(nodeSliderValues[1], window.nodeMin, window.nodeMax);
    const edgeMinValue = scaleToOriginalRange(edgeSliderValues[0], window.edgeMin, window.edgeMax);
    const edgeMaxValue = scaleToOriginalRange(edgeSliderValues[1], window.edgeMin, window.edgeMax);

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




// ############################################################################
// Cytoscape's visualization setting
// ############################################################################

// --------------------------------------------------------
// Slider for Font size
// --------------------------------------------------------
const fontSizeSlider = document.getElementById('font-size-slider');
noUiSlider.create(fontSizeSlider, {
    start: 20,
    connect: [true, false],
    range: {
        'min': 1,
        'max': 50
    },
    step: 1
});
fontSizeSlider.noUiSlider.on('update', function (value) {
    const intValues = Math.round(value);
    document.getElementById('font-size-value').textContent = intValues;
    cy.style().selector('node').style('font-size', intValues + 'px').update();
});

// --------------------------------------------------------
// Slider for Edge width
// --------------------------------------------------------
const edgeWidthSlider = document.getElementById('edge-width-slider');
noUiSlider.create(edgeWidthSlider, {
    start: 5,
    connect: [true, false],
    range: {
        'min': 1,
        'max': 10
    },
    step: 1
});
edgeWidthSlider.noUiSlider.on('update', function (value) {
    const intValues = Math.round(value);
    document.getElementById('edge-width-value').textContent = intValues;
    cy.style().selector('edge').style('width', function (ele) {
        return scaleValue(ele.data('edge_size'), edgeMin, edgeMax, 0.5, 2) * intValues;
    }).update();
});

// --------------------------------------------------------
// Slider for Node repulsion
// --------------------------------------------------------
const nodeRepulsionSlider = document.getElementById('nodeRepulsion-slider');
noUiSlider.create(nodeRepulsionSlider, {
    start: 5,
    connect: [true, false],
    range: {
        'min': 1,
        'max': 10
    },
    step: 1
});
nodeRepulsionSlider.noUiSlider.on('update', function (value) {
    const intValues = Math.round(value);
    nodeRepulsionValue = scaleToOriginalRange(parseFloat(intValues), nodeRepulsionMin, nodeRepulsionMax);
    componentSpacingValue = scaleToOriginalRange(parseFloat(intValues), componentSpacingMin, componentSpacingMax);
    document.getElementById('node-repulsion-value').textContent = intValues;
    cy.layout(getLayoutOptions()).run();
});


// ############################################################################
// Exporter
// ############################################################################

// --------------------------------------------------------
// PNG Exporter
// --------------------------------------------------------

document.getElementById('export-png').addEventListener('click', function () {
    const pngContent = cy.png({
        scale: 6.25,   // Scale to achieve 600 DPI
        full: true     // Set to true to include the entire graph, even the offscreen parts
    });

    const a = document.createElement('a');
    a.href = pngContent;
    a.download = 'TSUMUGI_male_infertility.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});


// --------------------------------------------------------
// CSV Exporter
// --------------------------------------------------------

function exportConnectedComponentsToCSV() {
    // calculateConnectedComponentsを利用して連結成分を取得
    const connected_component = calculateConnectedComponents();

    // CSVのヘッダー行
    let csvContent = "cluster,gene,phenotypes\n";

    // クラスター番号を割り当てて、CSVフォーマットに変換
    connected_component.forEach((component, clusterIndex) => {
        const clusterNumber = clusterIndex + 1;

        Object.keys(component).forEach(gene => {
            const phenotypes = component[gene].join(";"); // 表現型をセミコロン区切りで結合

            // CSVの各行を生成
            csvContent += `${clusterNumber},${gene},"${phenotypes}"\n`;
        });
    });

    // CSVファイルを生成しダウンロード
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'TSUMUGI_male_infertility.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// レイアウト変更後やフィルタリング後にCSVエクスポートのボタンを押したときに実行
document.getElementById('export-csv').addEventListener('click', function () {
    exportConnectedComponentsToCSV();
});
