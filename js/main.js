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
import { InsolationGrid } from './insolation/InsolationGrid.js';
import { DrawTool } from './editor/DrawTool.js';
import { InsolationCalculator } from './insolation/InsolationCalculator.js';
import { MoveTool } from './editor/MoveTool.js';
import { Compass } from './editor/Compass.js';
import { ProjectExporter } from './io/ProjectExporter.js';
import { ProjectImporter } from './io/ProjectImporter.js';
import { ViolationHighlighter } from './insolation/ViolationHighlighter.js';
import { SolarPotential } from './analysis/SolarPotential.js';
import { TowerPlacer } from './analysis/TowerPlacer.js';
import { TowerPlacerUI } from './analysis/TowerPlacerUI.js';
import { RectTool } from './editor/RectTool.js';

//import { VertexEditor } from './editor/VertexEditor.js'; // TODO: интегрировать позже


console.log('=== Insol Web v 0.2 ===');

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
let drawTool = null;
let rectTool = null;
let moveTool = null;
let insolationGrid = null;
let insolationCalculator = null;
let selectedResultIndex = null;
let compass = null;
let projectExporter = null;
let projectImporter = null;
let violationHighlighter = null;
let solarPotential = null;
let potentialMode = false;  // Режим рисования полигона для потенциала
let towerPlacer = null;
let towerPlacerUI = null;
let generationMode = false;  // Режим рисования полигона для генерации

// Для автоперерасчёта инсоляции
let lastCalculatedPoints = null;
let lastActiveMeshes = null;  // Массив активных зданий
let lastCalculationResults = null;

//let vertexEditor = null;

// ============================================
// Инициализация
// ============================================

/**
 * Обновить отображение координат центра сцены
 */
function updateCoordsDisplay(lat, lon) {
    let display = document.getElementById('coords-display');
    
    if (!display) {
        display = document.createElement('div');
        display.id = 'coords-display';
        display.className = 'coords-display hidden';
        document.body.appendChild(display);
    }
    
    if (lat !== undefined && lon !== undefined) {
        // Форматируем координаты: N 55.7558°, E 37.6173°
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';
        display.textContent = `${latDir} ${Math.abs(lat).toFixed(5)}°, ${lonDir} ${Math.abs(lon).toFixed(5)}°`;
        display.classList.remove('hidden');
    } else {
        display.classList.add('hidden');
    }
}

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
    document.getElementById('insolation-grid-btn').addEventListener('click', onInsolationGridClick);
    document.getElementById('select-all-points-btn').addEventListener('click', onSelectAllPointsClick);
    document.getElementById('calculate-insolation-btn').addEventListener('click', onCalculateInsolationClick);
    
    // Переключатель типа здания (жилое/нежилое)
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', onToggleBuildingType);
    });
    
    // Панель результатов
    document.getElementById('insolation-results-close').addEventListener('click', hideInsolationResults);
    

    // Кнопки лучей
    document.getElementById('toggle-rays-btn').addEventListener('click', onToggleRaysClick);
    document.getElementById('toggle-all-rays-btn').addEventListener('click', onToggleAllRaysClick);
    
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
        props.isResidential ? 'Жилое здание' : 'Здание';
    
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
    
    // Показываем обычные элементы карточки
    document.querySelectorAll('.single-select-only').forEach(el => el.style.display = '');
    const multiInfo = document.getElementById('multi-select-info');
    if (multiInfo) multiInfo.style.display = 'none';
}

/**
 * Показать карточку для множественного выбора
 */
function showMultiSelectCard(meshes) {
    const card = document.getElementById('building-card');
    
    if (!meshes || meshes.length === 0) {
        card.classList.add('hidden');
        return;
    }
    
    // Если выбрано только одно здание — показываем обычную карточку
    if (meshes.length === 1) {
        showBuildingCard(meshes[0].userData);
        return;
    }
    
    // Множественный выбор
    const residentialCount = meshes.filter(m => m.userData.properties?.isResidential).length;
    
    card.className = 'multi-select';
    
    document.getElementById('card-title').textContent = `Выбрано: ${meshes.length} зданий`;
    
    // Скрываем одиночные элементы, показываем мультивыбор
    document.querySelectorAll('.single-select-only').forEach(el => el.style.display = 'none');
    
    // Создаём или обновляем info блок для мультивыбора
    let multiInfo = document.getElementById('multi-select-info');
    if (!multiInfo) {
        multiInfo = document.createElement('div');
        multiInfo.id = 'multi-select-info';
        multiInfo.className = 'info-grid';
        const cardContent = card.querySelector('.card-content') || card;
        const infoGrid = card.querySelector('.info-grid');
        if (infoGrid) {
            infoGrid.parentNode.insertBefore(multiInfo, infoGrid);
        } else {
            cardContent.appendChild(multiInfo);
        }
    }
    
    multiInfo.innerHTML = `
        <div class="info-row">
            <span class="info-label">Жилых:</span>
            <span class="info-value">${residentialCount}</span>
        </div>
        <div class="info-row">
            <span class="info-label">Других:</span>
            <span class="info-value">${meshes.length - residentialCount}</span>
        </div>
    `;
    multiInfo.style.display = '';
    
    card.classList.remove('hidden');
    
    console.log(`[App] Множественный выбор: ${meshes.length} зданий (жилых: ${residentialCount})`);
}

    function closeBuildingCard() {
        document.getElementById('building-card').classList.add('hidden');
        
        if (heightEditor && heightEditor.isActive()) {
            heightEditor.deactivate();
        }
        
        // НЕ очищаем сетку инсоляции - она должна оставаться для перерасчёта
        // Сетка очищается только по кнопке "Убрать сетку"
        
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
        isResidential ? 'Жилое здание' : 'Здание';
    
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
        btn.textContent = 'Выбрать область';
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
    
    // Показываем координаты центра
    updateCoordsDisplay(centerLat, centerLon);
    
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
            // Если кликнули на потенциал — показываем панель управления
            if (data.subtype === 'solar-potential' && solarPotential) {
                solarPotential.showPanel();
                solarPotential.select();
                return;
            }
            
            // Снимаем выделение с потенциала если кликнули на другое
            if (solarPotential) {
                solarPotential.deselect();
            }
            
            showBuildingCard(data);
        },
        onMultiSelect: (meshes) => {
            // Снимаем выделение с потенциала
            if (solarPotential) {
                solarPotential.deselect();
            }
            showMultiSelectCard(meshes);
        }
    });

    // Редактор высоты
    heightEditor = new HeightEditor(sceneManager, {
        onChange: (mesh, height) => {
            // Обновляем карточку в реальном времени
            document.getElementById('card-height').textContent = `${height} м`;
            document.getElementById('card-height-source').textContent = 'Редактирование';
            
            // Перерасчёт инсоляции в реальном времени
            recalculateInsolationIfActive();
        },
        onComplete: (mesh, height) => {
            console.log(`[App] Высота изменена: ${mesh.userData.id} → ${height}м`);
            
            // Если сетка активна для этого здания — перестраиваем её
            if (insolationGrid && insolationGrid.isMeshActive(mesh)) {
                const activeMeshes = insolationGrid.getActiveMeshes();
                console.log(`[App] Перестроение сетки после изменения высоты`);
                insolationGrid.createGrid(activeMeshes);
                
                // Сбрасываем результаты расчётов
                lastCalculatedPoints = null;
                lastCalculationResults = null;
                
                // Скрываем лучи
                if (insolationCalculator) {
                    insolationCalculator.hideRays();
                    insolationCalculator.hideAllRays();
                }
                
                // Обновляем UI
                const toggleRaysBtn = document.getElementById('toggle-rays-btn');
                const toggleAllRaysBtn = document.getElementById('toggle-all-rays-btn');
                if (toggleRaysBtn) {
                    toggleRaysBtn.classList.remove('active');
                    toggleRaysBtn.textContent = 'Лучи точки';
                }
                if (toggleAllRaysBtn) {
                    toggleAllRaysBtn.classList.remove('active');
                    toggleAllRaysBtn.textContent = 'Все лучи';
                }
                
                // Скрываем панель результатов
                const resultsPanel = document.getElementById('insolation-results');
                if (resultsPanel) {
                    resultsPanel.classList.remove('visible');
                    resultsPanel.classList.add('hidden');
                }
            }
            
            // Финальный перерасчёт инсоляции
            recalculateInsolationIfActive();
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
            
            // Проверяем режим инсоляционного потенциала
            if (potentialMode) {
                // Получаем точки полигона
                const points = mesh.userData.basePoints;
                
                // Удаляем временный меш
                const group = sceneManager.getBuildingsGroup();
                group.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.dispose();
                
                // Выключаем режим потенциала
                potentialMode = false;
                editorToolbar.setTool('select');
                
                // Запускаем расчёт с диалогом настроек
                if (points && points.length >= 3) {
                    console.log(`[App] Запуск расчёта потенциала для ${points.length} точек`);
                    solarPotential.showSettingsAndCalculate(points);
                } else {
                    alert('Недостаточно точек для расчёта');
                }
                return;
            }
            
            // Проверяем режим генерации башен
            if (generationMode) {
                // Получаем точки полигона
                const points = mesh.userData.basePoints;
                
                // Делаем полигон обычным зданием (можно редактировать/удалять)
                mesh.material.color.setHex(0x2196f3);
                mesh.material.opacity = 0.3;
                mesh.material.transparent = true;
                // type остаётся 'building' - можно выбирать, удалять, менять высоту
                
                // Выключаем режим генерации
                generationMode = false;
                editorToolbar.setTool('select');
                
                // Открываем UI генерации с полигоном
                if (points && points.length >= 3 && towerPlacerUI) {
                    console.log(`[App] Запуск генерации для ${points.length} точек`);
                    towerPlacerUI.show(points, mesh);
                } else {
                    alert('Недостаточно точек для генерации');
                }
                return;
            }
            
            // Обычное создание здания
            editorToolbar.setTool('select');
            selectTool.select(mesh);
            showBuildingCard(mesh.userData);
            
            // Перерасчёт инсоляции — новое здание может затенять
            recalculateInsolationIfActive();
        }
    });

    // Инструмент рисования прямоугольников
    rectTool = new RectTool(sceneManager, coords, {
        onCreate: (mesh) => {
            console.log(`[App] Создан прямоугольник: ${mesh.userData.id}`);
            
            // Переключаемся на выбор
            editorToolbar.setTool('select');
            selectTool.select(mesh);
            showBuildingCard(mesh.userData);
            
            // Перерасчёт инсоляции
            recalculateInsolationIfActive();
        }
    });

    // Инструмент перемещения
    moveTool = new MoveTool(sceneManager, {
        onChange: (mesh) => {
            console.log(`[App] Здание перемещено: ${mesh.userData.id}`);
            
            // Перерасчёт инсоляции если сетка активна
            recalculateInsolationIfActive();
        },
        onMove: (mesh) => {
            // Синхронизируем сетку с текущим положением здания
            if (insolationGrid) {
                insolationGrid.syncWithMesh(mesh);
            }
            
            // Перерасчёт инсоляции в реальном времени
            recalculateInsolationIfActive();
        }
    });
    
    // Создаём компас (стили добавляются сразу)
    compass = new Compass();
    
    // Обновляем компас при вращении камеры
    sceneManager.controls.addEventListener('change', () => {
        if (compass) {
            compass.updateFromControls(sceneManager.controls);
        }
    });
    
    // Инициализация компаса после создания toolbar
    setTimeout(() => {
        compass.init();
        compass.updateFromControls(sceneManager.controls);
    }, 0);

    initInsolationTools();

    // Создаём экспортёр/импортёр проекта
    projectExporter = new ProjectExporter(sceneManager, coords, {
        mapCenter: { lat: coords.centerLat, lng: coords.centerLon },
        mapZoom: 17
    });
    
    projectImporter = new ProjectImporter(sceneManager, coords, buildingMesh, {
        onImportComplete: (results) => {
            const count = sceneManager.getBuildingsGroup().children.length;
            document.getElementById('building-count').textContent = `${count} зданий`;
            console.log(`[App] Импорт завершён: ${results.imported} зданий`);
        },
        onError: (err) => {
            alert(`Ошибка импорта: ${err}`);
        }
    });

    window.editorToolbar = editorToolbar;
    window.drawTool = drawTool;
    window.moveTool = moveTool;
    window.projectExporter = projectExporter;
    window.projectImporter = projectImporter;

    
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
        
        closeBuildingCard();
        
        const btn = document.getElementById('select-mode-btn');
        btn.textContent = 'Изменить область';
        btn.classList.remove('active');
        selectModeActive = false;
        
        if (areaSelector) {
            areaSelector.disableDrawing();
        }
        
        const loadBtn = document.getElementById('load-btn');
        loadBtn.textContent = 'Обновить область';
        updateLoadButton();
        
        // Очищаем инсоляцию
        if (insolationGrid) {
            insolationGrid.clearGrid();
            lastCalculatedPoints = null;
            lastCalculationResults = null;
            lastActiveMeshes = null;
        }
        if (insolationCalculator) {
            insolationCalculator.hideRays();
        }
        // Очищаем подсветку нарушений
        if (violationHighlighter) {
            violationHighlighter.clearAllHighlights();
            violationHighlighter.clearBaseline();
        }
        
        // Очищаем инсоляционный потенциал
        if (solarPotential) {
            solarPotential.clear();
        }
        potentialMode = false;
        
        // Скрываем координаты
        updateCoordsDisplay();
        
        // Выключаем инструменты
        if (moveTool) moveTool.disable();
        if (drawTool) drawTool.disable();
        
        console.log('[App] Возврат к карте');
    }

    function onToolChange(tool, prevTool) {
        console.log(`[App] onToolChange: ${prevTool} → ${tool}`);
        
        // Для delete не отключаем инструменты - просто удаляем и возвращаемся
        if (tool === 'delete') {
            deleteSelectedBuilding();
            return;
        }
        
        // Выключаем все инструменты
        if (drawTool) drawTool.disable();
        if (rectTool) rectTool.disable();
        if (moveTool) moveTool.disable();
        if (heightEditor) heightEditor.deactivate();
        if (selectTool) selectTool.setEnabled(false);
        
        // Гарантируем что камера разблокирована
        if (sceneManager && sceneManager.controls) {
            sceneManager.controls.enabled = true;
        }
        
        switch(tool) {
            case 'select':
                potentialMode = false;
                generationMode = false;
                if (selectTool) selectTool.setEnabled(true);
                break;
                
            case 'move':
                potentialMode = false;
                generationMode = false;
                // Только скрываем карточку, но сохраняем выделение для возможного удаления
                document.getElementById('building-card').classList.add('hidden');
                if (heightEditor && heightEditor.isActive()) {
                    heightEditor.deactivate();
                }
                if (moveTool) moveTool.enable();
                break;
                
            case 'draw':
                closeBuildingCard();
                potentialMode = false;
                generationMode = false;
                
                // Проверяем режим рисования
                const drawMode = editorToolbar.getDrawMode();
                if (drawMode === 'rect') {
                    if (rectTool) rectTool.enable();
                    console.log('[App] Режим рисования: прямоугольник');
                } else {
                    if (drawTool) drawTool.enable();
                    console.log('[App] Режим рисования: свободный полигон');
                }
                break;
                
            case 'potential':
                // Активируем режим потенциала и запускаем рисование
                closeBuildingCard();
                potentialMode = true;
                generationMode = false;
                if (drawTool) drawTool.enable();
                console.log('[App] Режим инсоляционного потенциала');
                break;
                
            case 'generate':
                // Активируем режим генерации и запускаем рисование
                closeBuildingCard();
                potentialMode = false;
                generationMode = true;
                if (drawTool) drawTool.enable();
                console.log('[App] Режим генерации застройки');
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
            // Сбрасываем MoveTool если он держит это здание
            if (moveTool) {
                moveTool.forceReset();
            }
            
            // Если удаляем здание с активной сеткой инсоляции — очищаем сетку
            if (insolationGrid && insolationGrid.isMeshActive(mesh)) {
                insolationGrid.clearGrid();
                lastCalculatedPoints = null;
                lastActiveMeshes = null;
                lastCalculationResults = null;
                
                // Скрываем UI инсоляции
                const gridBtn = document.getElementById('insolation-grid-btn');
                const selectAllBtn = document.getElementById('select-all-points-btn');
                const calcBtn = document.getElementById('calculate-insolation-btn');
                if (gridBtn) {
                    gridBtn.classList.remove('active');
                    gridBtn.textContent = 'Инсоляционная сетка';
                }
                if (selectAllBtn) selectAllBtn.classList.add('hidden');
                if (calcBtn) calcBtn.classList.add('hidden');
                
                // Скрываем панель результатов и лучи
                hideInsolationResults();
                if (insolationCalculator) {
                    insolationCalculator.hideRays();
                    insolationCalculator.hideAllRays();
                }
                
                console.log('[App] Сетка инсоляции очищена (здание удалено)');
            }
            
            const group = sceneManager.getBuildingsGroup();
            group.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            
            selectTool.deselect();
            closeBuildingCard();
            
            console.log(`[App] Удалено: ${mesh.userData.id}`);
            
            // Перерасчёт инсоляции — удалённое здание могло затенять другие
            recalculateInsolationIfActive();
        }
    }

    function onInsolationGridClick() {
        if (!selectTool || !insolationGrid) return;
        
        // Получаем все выбранные здания
        const selectedMeshes = selectTool.getSelectedMultiple();
        
        if (selectedMeshes.length === 0) {
            alert('Сначала выберите здание (Shift+клик для множественного выбора)');
            return;
        }
        
        const btn = document.getElementById('insolation-grid-btn');
        const selectAllBtn = document.getElementById('select-all-points-btn');
        const calcBtn = document.getElementById('calculate-insolation-btn');
        
        // Проверяем, совпадает ли текущая сетка с выбранными зданиями
        const activeMeshes = insolationGrid.getActiveMeshes();
        const isSameSelection = activeMeshes.length === selectedMeshes.length &&
            selectedMeshes.every(m => activeMeshes.includes(m));
        
        if (isSameSelection && activeMeshes.length > 0) {
            // Убираем сетку
            insolationGrid.clearGrid();
            lastCalculatedPoints = null;
            lastCalculationResults = null;
            lastActiveMeshes = null;
            btn.classList.remove('active');
            btn.textContent = 'Инсоляционная сетка';
            selectAllBtn.classList.add('hidden');
            calcBtn.classList.add('hidden');
            
            // Скрываем панель результатов
            const resultsPanel = document.getElementById('insolation-results');
            resultsPanel.classList.remove('visible');
            resultsPanel.classList.add('hidden');
            
            // Очищаем ВСЕ лучи
            if (insolationCalculator) {
                insolationCalculator.hideRays();
                insolationCalculator.hideAllRays();
            }
            
            // Сбрасываем кнопки лучей
            const toggleRaysBtn = document.getElementById('toggle-rays-btn');
            const toggleAllRaysBtn = document.getElementById('toggle-all-rays-btn');
            if (toggleRaysBtn) {
                toggleRaysBtn.classList.remove('active');
                toggleRaysBtn.textContent = 'Лучи точки';
            }
            if (toggleAllRaysBtn) {
                toggleAllRaysBtn.classList.remove('active');
                toggleAllRaysBtn.textContent = 'Все лучи';
            }
            
            console.log('[App] Сетка убрана');
            return;
        }
        
        // Создаём сетку для выбранных зданий
        const points = insolationGrid.createGrid(selectedMeshes);
        
        if (points && points.length > 0) {
            btn.classList.add('active');
            const buildingText = selectedMeshes.length === 1 ? '' : ` (${selectedMeshes.length} зд.)`;
            btn.textContent = `Убрать сетку${buildingText}`;
            selectAllBtn.classList.remove('hidden');
            calcBtn.classList.remove('hidden');
            console.log(`[App] Создана сетка: ${points.length} точек для ${selectedMeshes.length} зданий`);
        } else {
            alert('Не удалось создать сетку для выбранных зданий');
        }
    }

    function onSelectAllPointsClick() {
        if (!insolationGrid) return;
        
        const selected = insolationGrid.getSelectedPoints();
        
        if (selected.length === insolationGrid.getCalculationPoints().length) {
            insolationGrid.deselectAll();
        } else {
            insolationGrid.selectAll();
        }
    }

    function onCalculateInsolationClick() {
        if (!insolationGrid || !insolationCalculator) return;
        
        if (!insolationCalculator.isReady()) {
            alert('Солнечные векторы не загружены. Проверьте файл data/sun_vectors.json');
            return;
        }
        
        const selectedPoints = insolationGrid.getSelectedPoints();
        
        if (selectedPoints.length === 0) {
            alert('Выберите точки для расчёта (кликните на белые точки)');
            return;
        }
        
        const activeMeshes = insolationGrid.getActiveMeshes();
        
        // Сохраняем для автоперерасчёта
        lastCalculatedPoints = selectedPoints;
        lastActiveMeshes = activeMeshes;
        
        console.log(`[App] Расчёт инсоляции для ${selectedPoints.length} точек (${activeMeshes.length} зданий)...`);
        
        const calcBtn = document.getElementById('calculate-insolation-btn');
        calcBtn.textContent = 'Расчёт...';
        calcBtn.disabled = true;
        
        setTimeout(() => {
            // Сохраняем предыдущие результаты для сравнения
            if (lastCalculationResults && violationHighlighter) {
                violationHighlighter.saveBaseline(lastCalculationResults);
            }
            
            const { results, stats } = insolationCalculator.calculatePoints(
                selectedPoints, 
                null,  // Не исключаем здания
                120
            );
            
            // Сохраняем результаты для обновления лучей
            lastCalculationResults = results;
            
            results.forEach(r => {
                insolationGrid.setPointResult(r.point.index, r.evaluation);
            });
            
            // Проверяем ухудшение и подсвечиваем здания
            if (violationHighlighter && violationHighlighter.previousResults.size > 0) {
                const changes = violationHighlighter.checkAndHighlight(results, activeMeshes);
                if (changes.degraded > 0) {
                    console.log(`[App] ⚠️ Ухудшение инсоляции: ${changes.degraded} точек (${changes.worstLevel})`);
                }
            }
            
            showInsolationResults(results, stats);
            
            calcBtn.textContent = 'Рассчитать инсоляцию';
            calcBtn.disabled = false;
        }, 100);
    }
    
    /**
     * Перерасчёт инсоляции если есть активная сетка и рассчитанные точки
     */
    function recalculateInsolationIfActive() {
        if (!insolationGrid || !insolationCalculator) return;
        if (!lastCalculatedPoints || lastCalculatedPoints.length === 0) return;
        if (!lastActiveMeshes || lastActiveMeshes.length === 0) return;
        
        console.log(`[App] Автоперерасчёт инсоляции для ${lastCalculatedPoints.length} точек...`);
        
        // Запоминаем состояние лучей ДО перерасчёта
        const toggleBtn = document.getElementById('toggle-rays-btn');
        const toggleAllBtn = document.getElementById('toggle-all-rays-btn');
        const allRaysWereActive = toggleAllBtn && toggleAllBtn.classList.contains('active');
        const singleRaysWereActive = toggleBtn && toggleBtn.classList.contains('active');
        const savedResultIndex = selectedResultIndex;
        
        // Сохраняем предыдущие результаты для сравнения
        if (lastCalculationResults && violationHighlighter) {
            violationHighlighter.saveBaseline(lastCalculationResults);
        }
        
        // Пересчитываем с теми же точками
        const { results, stats } = insolationCalculator.calculatePoints(
            lastCalculatedPoints, 
            null,  // Не исключаем здания — minDistance защищает от самопересечения
            120
        );
        
        // Сохраняем результаты для обновления лучей
        lastCalculationResults = results;
        
        results.forEach(r => {
            insolationGrid.setPointResult(r.point.index, r.evaluation);
        });
        
        // Проверяем ухудшение и подсвечиваем здания
        if (violationHighlighter && violationHighlighter.previousResults.size > 0) {
            const changes = violationHighlighter.checkAndHighlight(results, lastActiveMeshes);
            if (changes.degraded > 0) {
                console.log(`[App] ⚠️ Ухудшение инсоляции: ${changes.degraded} точек (${changes.worstLevel})`);
            }
        }
        
        // Обновляем статистику БЕЗ сброса UI лучей
        document.getElementById('stat-pass').textContent = stats.pass;
        document.getElementById('stat-warning').textContent = stats.warning;
        document.getElementById('stat-fail').textContent = stats.fail;
        
        // Обновляем лучи если они были показаны
        if (allRaysWereActive) {
            insolationCalculator.showAllRays();
            console.log('[App] Лучи обновлены (все)');
        } else if (singleRaysWereActive && savedResultIndex !== null) {
            const r = lastCalculationResults[savedResultIndex];
            if (r) {
                insolationCalculator.showRays(r.point, r.collision);
                console.log(`[App] Лучи обновлены (точка ${savedResultIndex})`);
            }
        }
    }
    
    /**
     * Обновляем лучи если они были видимы
     */
    function updateRaysIfVisible() {
        if (!insolationCalculator || !lastCalculationResults) return;
        
        const toggleBtn = document.getElementById('toggle-rays-btn');
        const toggleAllBtn = document.getElementById('toggle-all-rays-btn');
        
        const allRaysActive = toggleAllBtn && toggleAllBtn.classList.contains('active');
        const singleRaysActive = toggleBtn && toggleBtn.classList.contains('active');
        
        console.log(`[App] updateRaysIfVisible: allRays=${allRaysActive}, singleRays=${singleRaysActive}, selectedIdx=${selectedResultIndex}`);
        
        // Если показаны все лучи
        if (allRaysActive) {
            insolationCalculator.showAllRays();
            console.log('[App] Лучи обновлены (все)');
        }
        // Если показаны лучи одной точки
        else if (singleRaysActive && selectedResultIndex !== null) {
            const r = lastCalculationResults[selectedResultIndex];
            if (r) {
                insolationCalculator.showRays(r.point, r.collision);
                console.log(`[App] Лучи обновлены (точка ${selectedResultIndex})`);
            }
        }
    }

    function showInsolationResults(results, stats) {
        document.getElementById('stat-pass').textContent = stats.pass;
        document.getElementById('stat-warning').textContent = stats.warning;
        document.getElementById('stat-fail').textContent = stats.fail;
        
        const detailsEl = document.getElementById('insolation-details');
        detailsEl.innerHTML = '';
        
        selectedResultIndex = null;
        
        // Сбрасываем кнопки лучей
        const toggleBtn = document.getElementById('toggle-rays-btn');
        const toggleAllBtn = document.getElementById('toggle-all-rays-btn');
        if (toggleBtn) {
            toggleBtn.classList.remove('active');
            toggleBtn.textContent = 'Лучи точки';
        }
        if (toggleAllBtn) {
            toggleAllBtn.classList.remove('active');
            toggleAllBtn.textContent = 'Все лучи';
        }
        
        results.forEach((r, index) => {
            const div = document.createElement('div');
            div.className = `detail-item ${r.evaluation.status.toLowerCase()}`;
            div.innerHTML = `
                <div class="title">Точка #${r.point.index + 1}</div>
                <div class="location">Фасад ${r.point.facadeIndex + 1}, Уровень ${r.point.level + 1}</div>
                <div class="message">${r.evaluation.message}</div>
                <div class="time">${r.evaluation.totalMinutes} / ${r.evaluation.requiredMinutes} мин</div>
            `;
            
            div.addEventListener('click', () => {
                detailsEl.querySelectorAll('.detail-item').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');
                
                selectedResultIndex = index;
                
                insolationCalculator.showRays(r.point, r.collision);
                
                const btn = document.getElementById('toggle-rays-btn');
                if (btn) {
                    btn.classList.add('active');
                    btn.textContent = 'Скрыть лучи';
                }
            });
            
            detailsEl.appendChild(div);
        });
        
        // Показываем панель
        const panel = document.getElementById('insolation-results');
        panel.classList.remove('hidden');
        
        requestAnimationFrame(() => {
            panel.classList.add('visible');
        });
    }

    function hideInsolationResults() {
        const panel = document.getElementById('insolation-results');
        panel.classList.remove('visible');
        
        setTimeout(() => {
            panel.classList.add('hidden');
        }, 300);
        
        if (insolationCalculator) {
            insolationCalculator.hideRays();
            insolationCalculator.hideAllRays();
        }
    }

    function initInsolationTools() {
        // Вызывается из onLoadClick после создания sceneManager
        insolationGrid = new InsolationGrid(sceneManager, {
            onPointSelect: (point) => {
                console.log(`[App] Выбрана точка ${point.index}`);
            },
            onPointDeselect: (point) => {
                console.log(`[App] Снят выбор точки ${point.index}`);
            }
        });
        window.insolationGrid = insolationGrid;

        insolationCalculator = new InsolationCalculator(sceneManager);
        insolationCalculator.loadSunVectors('data/sun_vectors.json').then(success => {
            if (success) {
                insolationCalculator.setLatitude(55.75);
            }
        });
        window.insolationCalculator = insolationCalculator;
        
        // Подсветка нарушений инсоляции
        violationHighlighter = new ViolationHighlighter(sceneManager, {
            flashCount: 3,
            flashDuration: 200,
            warningColor: 0xff9800,  // Оранжевый
            failColor: 0xf44336      // Красный
        });
        window.violationHighlighter = violationHighlighter;
        
        // Инсоляционный потенциал
        solarPotential = new SolarPotential(sceneManager, insolationCalculator, insolationGrid, {
            cellSize: 6,        // 6x6x6 кубики
            maxHeight: 75,      // Потолок по умолчанию
            animationDelay: 10,
            onProgress: (progress, iteration) => {
                const pct = Math.round(progress * 100);
                console.log(`[SolarPotential] Итерация ${iteration}: ${pct}%`);
            },
            onComplete: (stats) => {
                console.log('[SolarPotential] Завершено:', stats);
                alert(`Инсоляционный потенциал рассчитан!\n\nПлощадь: ${stats.totalArea.toFixed(0)} м²\nОбъём: ${stats.totalVolume.toFixed(0)} м³\nСредняя высота: ${stats.avgHeight.toFixed(1)} м\nМакс. высота: ${stats.maxHeight.toFixed(1)} м\n\nПотенциал можно удалить как обычное здание.`);
            }
        });
        window.solarPotential = solarPotential;
        
        // Генеративное размещение башен
        towerPlacer = new TowerPlacer(sceneManager, insolationCalculator, insolationGrid, {
            cellSize: 6,
            minFloors: 18,
            maxFloors: 50
        });
        
        towerPlacerUI = new TowerPlacerUI(towerPlacer, {
            onApply: (meshes, variant) => {
                console.log(`[App] Применён вариант: ${meshes.length} башен`);
                // Можно добавить в insolationGrid для расчёта
            }
        });
        
        window.towerPlacer = towerPlacer;
        window.towerPlacerUI = towerPlacerUI;
        
        console.log('[App] Инструменты инсоляции инициализированы');
    }


    function onToggleRaysClick() {
        if (!insolationCalculator) return;
        
        const btn = document.getElementById('toggle-rays-btn');
        
        if (selectedResultIndex !== null && insolationCalculator.lastResults) {
            const result = insolationCalculator.lastResults.results[selectedResultIndex];
            if (result) {
                const visible = insolationCalculator.toggleRays(result.point, result.collision);
                btn.classList.toggle('active', visible);
                btn.textContent = visible ? 'Скрыть лучи' : 'Показать лучи';
            }
        } else {
            alert('Сначала выберите точку в списке результатов');
        }
    }

    function onToggleAllRaysClick() {
        if (!insolationCalculator) return;
        
        const btn = document.getElementById('toggle-all-rays-btn');
        const visible = insolationCalculator.toggleAllRays();
        
        btn.classList.toggle('active', visible);
        btn.textContent = visible ? 'Скрыть все' : 'Все лучи';
    }

// ============================================
// Экспорт/Импорт проекта
// ============================================

function exportProjectToGeoJSON() {
    if (!projectExporter) {
        alert('Сначала загрузите область на карте');
        return;
    }
    
    const timestamp = new Date().toISOString().slice(0, 10);
    projectExporter.downloadGeoJSON(`insol-project-${timestamp}.geojson`);
}

function exportProjectToOBJ() {
    if (!projectExporter) {
        alert('Сначала загрузите область на карте');
        return;
    }
    
    const timestamp = new Date().toISOString().slice(0, 10);
    // downloadOBJ async - но не ждём результата, он сам покажет диалог
    projectExporter.downloadOBJ(`insol-project-${timestamp}`).catch(e => {
        console.error('[App] Ошибка экспорта OBJ:', e);
        alert('Ошибка экспорта: ' + e.message);
    });
}

/**
 * Запустить расчёт инсоляционного потенциала
 */
function startSolarPotential() {
    if (!solarPotential) {
        alert('Сначала загрузите область на карте');
        return;
    }
    
    if (!insolationCalculator || !insolationCalculator.sunVectors) {
        alert('Солнечные векторы не загружены');
        return;
    }
    
    // Проверяем есть ли активная инсоляционная сетка
    if (!insolationGrid || insolationGrid.getCalculationPoints().length === 0) {
        alert('Сначала создайте инсоляционную сетку на жилых зданиях:\n\n1. Выделите жилые здания\n2. Нажмите "Сетка инсоляции"\n3. Затем запустите расчёт потенциала');
        return;
    }
    
    // Активируем режим рисования полигона
    potentialMode = true;
    
    // Переключаемся на инструмент рисования
    if (editorToolbar) {
        editorToolbar.setTool('draw');
    }
    
    alert('Нарисуйте полигон участка для расчёта.\n\nКлик — точка\nДвойной клик или Enter — завершить\n\nЯчейки будут расти пока не затенят окна.');
    
    console.log('[App] Режим инсоляционного потенциала активирован');
}

window.startSolarPotential = startSolarPotential;

/**
 * Запустить генерацию застройки
 */
function startTowerGeneration() {
    if (!insolationCalculator || !insolationCalculator.isReady()) {
        alert('Сначала загрузите область и дождитесь расчёта солнечных векторов');
        return;
    }
    
    if (!towerPlacer) {
        alert('Генератор не инициализирован');
        return;
    }
    
    // Включаем режим генерации
    generationMode = true;
    
    // Переключаем на рисование
    if (editorToolbar) {
        editorToolbar.setTool('generate');
    }
    
    alert('Нарисуйте полигон участка для застройки.\n\nКлик — точка\nДвойной клик или Enter — завершить\n\nАлгоритм разместит башни с учётом инсоляции.');
    
    console.log('[App] Режим генерации застройки активирован');
}

window.startTowerGeneration = startTowerGeneration;

/**
 * Заблокировать потенциал (не влияет на лучи)
 */
function blockSolarPotential() {
    if (!solarPotential || !solarPotential.resultMesh) {
        console.warn('Потенциал не создан');
        return;
    }
    solarPotential.block();
}

window.blockSolarPotential = blockSolarPotential;

/**
 * Разблокировать потенциал (влияет на лучи)
 */
function unblockSolarPotential() {
    if (!solarPotential || !solarPotential.resultMesh) {
        console.warn('Потенциал не создан');
        return;
    }
    solarPotential.unblock();
}

window.unblockSolarPotential = unblockSolarPotential;

/**
 * Переключить блокировку потенциала
 */
function toggleSolarPotentialBlock() {
    if (!solarPotential || !solarPotential.resultMesh) {
        console.warn('Потенциал не создан');
        return false;
    }
    return solarPotential.toggleBlock();
}

window.toggleSolarPotentialBlock = toggleSolarPotentialBlock;

/**
 * Скрыть потенциал
 */
function hideSolarPotential() {
    if (!solarPotential || !solarPotential.resultMesh) {
        return;
    }
    solarPotential.hide();
}

window.hideSolarPotential = hideSolarPotential;

/**
 * Показать потенциал
 */
function showSolarPotential() {
    if (!solarPotential || !solarPotential.resultMesh) {
        return;
    }
    solarPotential.show();
}

window.showSolarPotential = showSolarPotential;

/**
 * Переключить видимость потенциала
 */
function toggleSolarPotentialVisibility() {
    if (!solarPotential || !solarPotential.resultMesh) {
        return false;
    }
    return solarPotential.toggleVisibility();
}

window.toggleSolarPotentialVisibility = toggleSolarPotentialVisibility;

/**
 * Скрыть футпринт потенциала
 */
function hideSolarPotentialFootprint() {
    if (!solarPotential || !solarPotential.groundOutline) {
        return;
    }
    solarPotential.hideFootprint();
}

window.hideSolarPotentialFootprint = hideSolarPotentialFootprint;

/**
 * Показать футпринт потенциала
 */
function showSolarPotentialFootprint() {
    if (!solarPotential || !solarPotential.groundOutline) {
        return;
    }
    solarPotential.showFootprint();
}

window.showSolarPotentialFootprint = showSolarPotentialFootprint;

/**
 * Переключить видимость футпринта
 */
function toggleSolarPotentialFootprint() {
    if (!solarPotential || !solarPotential.groundOutline) {
        return false;
    }
    return solarPotential.toggleFootprint();
}

window.toggleSolarPotentialFootprint = toggleSolarPotentialFootprint;

/**
 * Выделить потенциал
 */
function selectSolarPotential() {
    if (solarPotential && solarPotential.resultMesh) {
        solarPotential.select();
    }
}

window.selectSolarPotential = selectSolarPotential;

/**
 * Снять выделение потенциала
 */
function deselectSolarPotential() {
    if (solarPotential && solarPotential.resultMesh) {
        solarPotential.deselect();
    }
}

window.deselectSolarPotential = deselectSolarPotential;

// Для обратной совместимости
window.toggleSolarPotentialGhost = toggleSolarPotentialBlock;

// TODO: Импорт GeoJSON временно отключён — требует доработки
// function importProjectFromGeoJSON() {
//     if (!projectImporter) {
//         alert('Сначала загрузите область на карте');
//         return;
//     }
//     
//     const input = document.createElement('input');
//     input.type = 'file';
//     input.accept = '.geojson,.json';
//     
//     input.onchange = (e) => {
//         const file = e.target.files[0];
//         if (file) {
//             const confirmClear = confirm('Очистить существующие здания перед импортом?');
//             if (confirmClear) {
//                 projectImporter.clearAllBuildings();
//             }
//             projectImporter.importFromFile(file);
//         }
//     };
//     
//     input.click();
// }

// Глобальные функции для вызова из UI
window.exportProjectToGeoJSON = exportProjectToGeoJSON;
window.exportProjectToOBJ = exportProjectToOBJ;
// window.importProjectFromGeoJSON = importProjectFromGeoJSON;

// ============================================
// Запуск
// ============================================

init();