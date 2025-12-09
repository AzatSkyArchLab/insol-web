/**
 * ============================================
 * main.js
 * Insol Web — Точка входа
 * ============================================
 */

import { Coordinates } from './core/Coordinates.js';
import { MapEngine } from './core/MapEngine.js';
import { SceneManager } from './core/SceneManager.js';
import { BuildingLoader } from './buildings/BuildingLoader.js';
import { BuildingMesh } from './buildings/BuildingMesh.js';
import { AreaSelector } from './editor/AreaSelector.js';
import { SelectTool } from './editor/SelectTool.js';
import { HeightEditor } from './editor/HeightEditor.js';
import { EditorToolbar } from './editor/EditorToolbar.js';
//import { MoveTool } from './editor/MoveTool.js'; Добавим это когда-нибудь потоооом :)
//import { VertexEditor } from './editor/VertexEditor.js'; и это :)
import { DrawTool } from './editor/DrawTool.js';

console.log('=== Insol Web v0.1 ===');

// ============================================
// Глобальные переменные
// ============================================

let coords = null;
let mapEngine = null;
let sceneManager = null;
let buildingLoader = null;
let buildingMesh = null;
let areaSelector = null;
let selectTool = null;

let selectedBounds = null;
let selectModeActive = false;
let heightEditor = null;

let editorToolbar = null;
//let moveTool = null;
//let vertexEditor = null;
let drawTool = null;

// ============================================
// Инициализация
// ============================================

function init() {
    mapEngine = new MapEngine('map', {
        center: [37.6173, 55.7558],
        zoom: 15
    });
    mapEngine.init();
    
    buildingLoader = new BuildingLoader();
    
    mapEngine.getMap().on('load', () => {
        areaSelector = new AreaSelector(mapEngine, {
            maxSize: 500,
            onSelect: (bounds) => {
                selectedBounds = bounds;
                console.log('[App] Выбрана область:', bounds);
            },
            onChange: (bounds) => {
                updateLoadButton();
            }
        });
        
        console.log('[App] Карта готова');
    });
    
    // Кнопки
    document.getElementById('select-mode-btn').addEventListener('click', onSelectModeClick);
    document.getElementById('load-btn').addEventListener('click', onLoadClick);
    document.getElementById('back-btn').addEventListener('click', onBackClick);
    document.getElementById('card-close').addEventListener('click', closeBuildingCard);
    document.getElementById('edit-height-btn').addEventListener('click', onEditHeightClick);

    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', onToggleBuildingType);
    });
    
    window.mapEngine = mapEngine;
    window.buildingLoader = buildingLoader;
}

// ============================================
// UI Helpers
// ============================================

function updateLoadButton() {
    const loadBtn = document.getElementById('load-btn');
    if (loadBtn && areaSelector) {
        loadBtn.disabled = !areaSelector.isValid();
    }
}

// ============================================
// Карточка здания
// ============================================

// ============================================
// Карточка здания
// ============================================

function showBuildingCard(data) {
    const card = document.getElementById('building-card');
    
    if (!data) {
        card.classList.add('hidden');
        return;
    }
    
    const props = data.properties || {};
    
    // Обновляем класс карточки
    card.className = props.isResidential ? 'residential' : 'other';
    
    // Заголовок
    document.getElementById('card-title').textContent = 
        props.isResidential ? '🏠 Жилое здание' : '🏢 Здание';
    
    // Обновляем toggle кнопки
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        const btnResidential = btn.dataset.residential === 'true';
        btn.classList.remove('active', 'residential', 'other');
        if (btnResidential === props.isResidential) {
            btn.classList.add('active', props.isResidential ? 'residential' : 'other');
        }
    });
    
    // Данные
    document.getElementById('card-function').textContent = 
        formatBuildingType(props.buildingType);
    
    document.getElementById('card-levels').textContent = 
        props.levels ? props.levels : '—';
    
    document.getElementById('card-height').textContent = 
        props.height ? `${props.height.toFixed(1)} м` : '—';
    
    document.getElementById('card-height-source').textContent = 
        props.heightSource === 'osm' ? 'OSM (точная)' : 
        props.heightSource === 'levels' ? 'Из этажей' : 
        props.heightSource === 'edited' ? 'Редактирование' : 'По умолчанию';
    
    document.getElementById('card-address').textContent = 
        props.address || '—';
    
    document.getElementById('card-osm-id').textContent = 
        data.id || '—';
    
    card.classList.remove('hidden');
}

function closeBuildingCard() {
    document.getElementById('building-card').classList.add('hidden');
    
    // Закрываем редактор высоты
    if (heightEditor && heightEditor.isActive()) {
        heightEditor.deactivate();
    }
    
    if (selectTool) {
        selectTool.deselect();
    }
}

function formatBuildingType(type) {
    const types = {
        'apartments': 'Многоквартирный дом',
        'residential': 'Жилой дом',
        'house': 'Дом',
        'detached': 'Отдельный дом',
        'dormitory': 'Общежитие',
        'commercial': 'Коммерческое',
        'retail': 'Торговое',
        'office': 'Офисное',
        'industrial': 'Промышленное',
        'warehouse': 'Склад',
        'school': 'Школа',
        'university': 'Университет',
        'hospital': 'Больница',
        'church': 'Церковь',
        'garage': 'Гараж',
        'garages': 'Гаражи',
        'shed': 'Сарай',
        'roof': 'Навес',
        'yes': 'Не указано'
    };
    
    return types[type] || type || 'Не указано';
}


function onEditHeightClick() {
    if (!selectTool || !heightEditor) return;
    
    const selectedMesh = selectTool.getSelected();
    if (selectedMesh) {
        heightEditor.activate(selectedMesh);
    }
}

function onToggleBuildingType(event) {
    if (!selectTool) return;
    
    const selectedMesh = selectTool.getSelected();
    if (!selectedMesh) return;
    
    const isResidential = event.target.dataset.residential === 'true';
    
    // Обновляем данные
    selectedMesh.userData.properties.isResidential = isResidential;
    
    // Обновляем цвет
    const newColor = isResidential ? 0x5b8dd9 : 0x888888;
    selectedMesh.material.color.setHex(newColor);
    selectedMesh.userData.originalColor = newColor;
    
    // Обновляем кнопки
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.classList.remove('active', 'residential', 'other');
    });
    event.target.classList.add('active', isResidential ? 'residential' : 'other');
    
    // Обновляем заголовок карточки
    const card = document.getElementById('building-card');
    card.className = isResidential ? 'residential' : 'other';
    document.getElementById('card-title').textContent = 
        isResidential ? '🏠 Жилое здание' : '🏢 Здание';
    
    console.log(`[App] Тип изменён: ${selectedMesh.userData.id} → ${isResidential ? 'жилое' : 'нежилое'}`);
}

// ============================================
// Переключение режима выбора
// ============================================

function onSelectModeClick() {
    selectModeActive = !selectModeActive;
    
    const btn = document.getElementById('select-mode-btn');
    
    if (selectModeActive) {
        btn.textContent = '✕ Отменить';
        btn.classList.add('active');
        areaSelector.setEnabled(true);
    } else {
        btn.textContent = '✎ Выбрать область';
        btn.classList.remove('active');
        areaSelector.disableDrawing();
    }
}

// ============================================
// Загрузка 3D-сцены
// ============================================

async function onLoadClick() {
    if (!selectedBounds) return;
    
    const btn = document.getElementById('load-btn');
    btn.textContent = 'Загрузка...';
    btn.disabled = true;
    
    console.log('[App] Загрузка области...');
    
    const centerLat = (selectedBounds.south + selectedBounds.north) / 2;
    const centerLon = (selectedBounds.west + selectedBounds.east) / 2;
    
    const heightM = (selectedBounds.north - selectedBounds.south) * 111320;
    const widthM = (selectedBounds.east - selectedBounds.west) * 111320 * Math.cos(centerLat * Math.PI / 180);
    
    coords = new Coordinates(centerLat, centerLon);
    
    const buildings = await buildingLoader.loadBuildings(
        selectedBounds.south,
        selectedBounds.west,
        selectedBounds.north,
        selectedBounds.east
    );
    
    // Переключаем режим
    document.getElementById('map-mode').classList.add('hidden');
    document.getElementById('scene-mode').classList.remove('hidden');
    
    // Создаём или обновляем сцену
    if (sceneManager) {
        sceneManager.clearBuildings();
    } else {
        sceneManager = new SceneManager('scene-container', coords);
        sceneManager.init();
    }
    
    sceneManager.coordinates = coords;
    sceneManager.setAreaSize(widthM, heightM);
    sceneManager.loadGroundTile(selectedBounds);
    
    // Создаём меши
    buildingMesh = new BuildingMesh(coords);
    const meshes = buildingMesh.createMeshes(buildings);
    
    const group = sceneManager.getBuildingsGroup();
    for (const mesh of meshes) {
        group.add(mesh);
    }
    
    // Инструмент выбора
    selectTool = new SelectTool(sceneManager, {
        onSelect: (data, mesh) => {
            showBuildingCard(data);
        }
    });

    // Редактор высоты
    heightEditor = new HeightEditor(sceneManager, {
        onChange: (mesh, height) => {
            // Обновляем карточку в реальном времени
            document.getElementById('card-height').textContent = `${height} м`;
            document.getElementById('card-height-source').textContent = 'Редактирование';
        },
        onComplete: (mesh, height) => {
            console.log(`[App] Высота изменена: ${mesh.userData.id} → ${height}м`);
        }
    });

        // Панель инструментов

    editorToolbar = new EditorToolbar({
        onChange: onToolChange
    });

    // Инструмент рисования
    drawTool = new DrawTool(sceneManager, coords, {
        onCreate: (mesh) => {
            console.log(`[App] Создан полигон: ${mesh.userData.id}`);
            // Переключаемся на выбор и выделяем созданное здание
            editorToolbar.setTool('select');
            selectTool.select(mesh);
            showBuildingCard(mesh.userData);
        }
    });

    window.editorToolbar = editorToolbar;
    window.drawTool = drawTool;

    
    // Статистика
    const residentialCount = buildings.filter(b => b.properties.isResidential).length;
    document.getElementById('building-count').textContent = 
        `${meshes.length} (жилых: ${residentialCount})`;
    
    btn.textContent = 'Загрузить область';
    
    window.sceneManager = sceneManager;
    window.selectTool = selectTool;
    window.coords = coords;
    
    console.log(`[App] Загружено: ${meshes.length} зданий, жилых: ${residentialCount}`);
}

// ============================================
// Возврат к карте
// ============================================

    function onBackClick() {
        document.getElementById('scene-mode').classList.add('hidden');
        document.getElementById('map-mode').classList.remove('hidden');
        
        // Закрываем карточку
        closeBuildingCard();
        
        // Сброс UI
        const btn = document.getElementById('select-mode-btn');
        btn.textContent = '✎ Изменить область';
        btn.classList.remove('active');
        selectModeActive = false;
        
        if (areaSelector) {
            areaSelector.disableDrawing();
        }
        
        const loadBtn = document.getElementById('load-btn');
        loadBtn.textContent = 'Обновить область';
        updateLoadButton();
        
        console.log('[App] Возврат к карте');
    }


    function onToolChange(tool, prevTool) {
        // Отключаем инструменты
        if (drawTool) drawTool.disable();
        if (heightEditor) heightEditor.deactivate();
        
        // Включаем выбранный
        switch(tool) {
            case 'select':
                // SelectTool всегда активен
                break;
            case 'draw':
                if (selectTool) selectTool.deselect();
                closeBuildingCard();
                drawTool.enable();
                break;
            case 'delete':
                deleteSelectedBuilding();
                break;
        }
    }

    function deleteSelectedBuilding() {
        if (!selectTool) {
            console.warn('[App] SelectTool не инициализирован');
            return;
        }
        
        const mesh = selectTool.getSelected();
        console.log('[App] Попытка удаления, выбрано:', mesh);
        
        if (!mesh) {
            alert('Сначала выберите здание (инструмент "Выбор")');
            return;
        }
        
        if (confirm(`Удалить здание ${mesh.userData.id}?`)) {
            const group = sceneManager.getBuildingsGroup();
            group.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            
            selectTool.deselect();
            closeBuildingCard();
            
            console.log(`[App] Удалено: ${mesh.userData.id}`);
        }
    }


// ============================================
// Запуск
// ============================================

init();