/**
 * ============================================
 * App.js
 * Главный класс приложения
 * ============================================
 * 
 * Связывает модули, инициализирует контроллеры.
 * Точка входа для всего приложения.
 */

import { EventBus } from './EventBus.js';
import { AppState } from './AppState.js';

// Core
import { Coordinates } from '../core/Coordinates.js';
import { MapEngine } from '../core/MapEngine.js';
import { SceneManager } from '../core/SceneManager_NEW.js';

// Buildings
import { BuildingLoader } from '../buildings/BuildingLoader.js';
import { BuildingMesh } from '../buildings/BuildingMesh.js';

// Editor
import { AreaSelector } from '../editor/AreaSelector.js';
import { SelectTool } from '../editor/SelectTool.js';
import { HeightEditor } from '../editor/HeightEditor.js';
import { EditorToolbar } from '../editor/EditorToolbar.js';
import { DrawTool } from '../editor/DrawTool.js';
import { RectTool } from '../editor/RectTool.js';
import { MoveTool } from '../editor/MoveTool.js';
import { Compass } from '../editor/Compass.js';
import { MeasureTool } from '../editor/MeasureTool.js';
import { MapMeasureTool } from '../editor/MapMeasureTool.js';
import { MeasureRenderer3D } from '../editor/MeasureRenderer3D.js';

// Insolation
import { InsolationGrid } from '../insolation/InsolationGrid.js';
import { InsolationCalculator } from '../insolation/InsolationCalculator.js';
import { ViolationHighlighter } from '../insolation/ViolationHighlighter.js';

// Analysis
import { SolarPotential } from '../analysis/SolarPotential.js';
import { TowerPlacer } from '../analysis/TowerPlacer.js';
import { TowerPlacerUI } from '../analysis/TowerPlacerUI.js';
import { SolarRadiation } from '../analysis/SolarRadiation.js';  // <-- ДОБАВЛЕНО
// WindCFD импортируется динамически в WindController

// I/O
import { ProjectExporter } from '../io/ProjectExporter.js';
import { ProjectImporter } from '../io/ProjectImporter.js';

// Controllers
import { BuildingCardController } from '../controllers/BuildingCardController.js';
import { InsolationController } from '../controllers/InsolationController.js';
import { WindController } from '../controllers/WindController.js';
import { ProjectController } from '../controllers/ProjectController.js';
import { UnderlayController } from '../controllers/UnderlayController.js';
import { DetailedGridController } from '../controllers/DetailedGridController.js';
import { SolarRadiationController } from '../controllers/SolarRadiationController.js';  // <-- ДОБАВЛЕНО


class App {
    constructor() {
        this.bus = new EventBus();
        this.state = new AppState();
        
        // Контроллеры (будут добавляться)
        this.controllers = {};
        
        console.log('[App] Создан');
    }
    
    /**
     * Инициализация приложения
     */
    init() {
        this._initControllers();
        this._initMap();
        this._bindGlobalEvents();
        this._exposeDebugGlobals();
        
        console.log('[App] Инициализирован');
    }
    
    /**
     * Инициализация контроллеров
     */
    _initControllers() {
        this.controllers = {
            buildingCard: new BuildingCardController(this),
            insolation: new InsolationController(this),
            wind: new WindController(this),
            project: new ProjectController(this),
            underlay: new UnderlayController(this),
            detailedGrid: new DetailedGridController(this),
            solarRadiation: new SolarRadiationController(this)  // <-- ДОБАВЛЕНО
        };
    }
    
    /**
     * Инициализация карты
     */
    _initMap() {
        const { state } = this;
        
        state.mapEngine = new MapEngine('map', {
            center: [37.6173, 55.7558],
            zoom: 15
        });
        state.mapEngine.init();
        
        state.buildingLoader = new BuildingLoader();
        
        state.mapEngine.getMap().on('load', () => {
            state.areaSelector = new AreaSelector(state.mapEngine, {
                maxSize: 500,
                onSelect: (bounds) => {
                    state.selectedBounds = bounds;
                    this.bus.emit('area:selected', { bounds });
                },
                onChange: (bounds) => {
                    this._updateLoadButton();
                }
            });
            
            // Инициализация линейки на карте
            state.mapMeasureTool = new MapMeasureTool(state.mapEngine);
            this._initMapMeasureButton();
            
            console.log('[App] Карта готова');
        });
    }
    
    /**
     * Инициализация кнопки линейки на карте
     */
    _initMapMeasureButton() {
        const { state } = this;
        const btn = document.getElementById('map-measure-btn');
        if (!btn) return;
        
        btn.addEventListener('click', () => {
            const isActive = btn.classList.toggle('active');
            
            if (isActive) {
                state.mapMeasureTool.enable();
                // Выключаем режим выбора области если активен
                if (state.selectModeActive) {
                    this.onSelectModeClick();
                }
            } else {
                state.mapMeasureTool.disable();
            }
        });
        
        // Очистка по Escape
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Escape' && state.mapMeasureTool?.enabled) {
                state.mapMeasureTool.clear();
            }
            
            // Удаление выбранных зданий по Delete/Backspace
            if ((e.code === 'Delete' || e.code === 'Backspace') && !e.target.matches('input, textarea')) {
                this._deleteSelectedBuilding();
            }
        });
    }
    
    /**
     * Привязка глобальных DOM-событий
     */
    _bindGlobalEvents() {
        document.getElementById('select-mode-btn')
            .addEventListener('click', () => this.onSelectModeClick());
        
        document.getElementById('load-btn')
            .addEventListener('click', () => this.onLoadClick());
        
        document.getElementById('back-btn')
            .addEventListener('click', () => this.onBackClick());
        
        // Переключатель слоёв карты
        this._initLayerSwitchers();
    }
    
    /**
     * Инициализация переключателей слоёв
     */
    _initLayerSwitchers() {
        const { state } = this;
        
        // Переключатель на карте
        const mapSwitcher = document.getElementById('map-layer-switcher');
        if (mapSwitcher) {
            mapSwitcher.querySelectorAll('.layer-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const layer = btn.dataset.layer;
                    
                    // Обновляем UI
                    mapSwitcher.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    // Переключаем карту с callback для восстановления слоёв
                    if (state.mapEngine) {
                        state.mapEngine.setMapSource(layer, () => {
                            // Восстанавливаем слои линейки если есть измерения или она активна
                            if (state.mapMeasureTool && (state.mapMeasureTool.enabled || state.mapMeasureTool.measurements.length > 0)) {
                                state.mapMeasureTool._initLayers();
                                state.mapMeasureTool._updateLayers();
                                state.mapMeasureTool._updateAllLabelPositions();
                            }
                            // Восстанавливаем AreaSelector если активен
                            if (state.areaSelector) {
                                state.areaSelector._restoreLayers?.();
                            }
                        });
                    }
                    
                    // Синхронизируем с переключателем сцены
                    this._syncLayerSwitcher('scene-layer-switcher', layer);
                    
                    // Сохраняем в state
                    state.currentMapSource = layer;
                });
            });
        }
        
        // Переключатель в 3D-сцене
        const sceneSwitcher = document.getElementById('scene-layer-switcher');
        if (sceneSwitcher) {
            sceneSwitcher.querySelectorAll('.layer-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const layer = btn.dataset.layer;
                    
                    // Обновляем UI
                    sceneSwitcher.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    // Переключаем тайлы сцены
                    if (state.sceneManager) {
                        state.sceneManager.setTileSource(layer);
                    }
                    
                    // Синхронизируем с переключателем карты
                    this._syncLayerSwitcher('map-layer-switcher', layer);
                    
                    // Сохраняем в state
                    state.currentMapSource = layer;
                });
            });
        }
    }
    
    /**
     * Синхронизация переключателей слоёв
     */
    _syncLayerSwitcher(switcherId, layer) {
        const switcher = document.getElementById(switcherId);
        if (switcher) {
            switcher.querySelectorAll('.layer-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.layer === layer);
            });
        }
    }
    
    /**
     * Инициализация контролов вида (сетка, сдвиг тайлов)
     */
    _initViewControls() {
        const { state } = this;
        
        // Переключатель сетки
        const gridToggle = document.getElementById('grid-toggle');
        if (gridToggle) {
            gridToggle.addEventListener('click', () => {
                gridToggle.classList.toggle('active');
                const visible = gridToggle.classList.contains('active');
                if (state.sceneManager) {
                    state.sceneManager.toggleHelpers(visible);
                }
            });
        }
        
        // Сдвиг тайлов X
        const offsetX = document.getElementById('tile-offset-x');
        const offsetXVal = document.getElementById('tile-offset-x-val');
        if (offsetX) {
            offsetX.addEventListener('input', () => {
                const x = parseFloat(offsetX.value);
                const y = parseFloat(document.getElementById('tile-offset-y').value);
                offsetXVal.textContent = `${x} м`;
                if (state.sceneManager) {
                    state.sceneManager.setTileOffset(x, y);
                }
            });
        }
        
        // Сдвиг тайлов Y
        const offsetY = document.getElementById('tile-offset-y');
        const offsetYVal = document.getElementById('tile-offset-y-val');
        if (offsetY) {
            offsetY.addEventListener('input', () => {
                const x = parseFloat(document.getElementById('tile-offset-x').value);
                const y = parseFloat(offsetY.value);
                offsetYVal.textContent = `${y} м`;
                if (state.sceneManager) {
                    state.sceneManager.setTileOffset(x, y);
                }
            });
        }
        
        // Кнопка сброса
        const resetBtn = document.getElementById('tile-offset-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                document.getElementById('tile-offset-x').value = 0;
                document.getElementById('tile-offset-y').value = 0;
                document.getElementById('tile-offset-x-val').textContent = '0 м';
                document.getElementById('tile-offset-y-val').textContent = '0 м';
                if (state.sceneManager) {
                    state.sceneManager.setTileOffset(0, 0);
                }
            });
        }
    }
    
    /**
     * Инициализация рендерера измерений
     */
    _initMeasureRenderer() {
        const { state } = this;
        
        // Создаём рендерер
        state.measureRenderer3D = new MeasureRenderer3D(state.sceneManager, state.coords);
        
        // Загружаем измерения с карты если есть
        if (state.mapMeasureTool?.measurements?.length > 0) {
            state.measureRenderer3D.loadFromMap(state.mapMeasureTool.measurements);
        }
        
        // Обновляем метки при движении камеры
        state.sceneManager.controls.addEventListener('change', () => {
            if (state.measureRenderer3D) {
                state.measureRenderer3D.updateLabels();
            }
        });
    }
    
    /**
     * Переключение режима выбора области
     */
    onSelectModeClick() {
        const { state } = this;
        state.selectModeActive = !state.selectModeActive;
        
        const btn = document.getElementById('select-mode-btn');
        
        if (state.selectModeActive) {
            btn.textContent = '✕ Отменить';
            btn.classList.add('active');
            state.areaSelector.setEnabled(true);
        } else {
            btn.textContent = 'Выбрать область';
            btn.classList.remove('active');
            state.areaSelector.disableDrawing();
        }
    }
    
    /**
     * Загрузка 3D-сцены
     */
    async onLoadClick() {
        const { state, bus } = this;
        
        if (!state.selectedBounds) return;
        
        const btn = document.getElementById('load-btn');
        btn.textContent = 'Загрузка...';
        btn.disabled = true;
        
        const bounds = state.selectedBounds;
        const centerLat = (bounds.south + bounds.north) / 2;
        const centerLon = (bounds.west + bounds.east) / 2;
        const heightM = (bounds.north - bounds.south) * 111320;
        const widthM = (bounds.east - bounds.west) * 111320 * Math.cos(centerLat * Math.PI / 180);
        
        // Координаты
        state.coords = new Coordinates(centerLat, centerLon);
        this._updateCoordsDisplay(centerLat, centerLon);
        
        // Загрузка зданий
        const buildings = await state.buildingLoader.loadBuildings(
            bounds.south, bounds.west, bounds.north, bounds.east
        );
        
        // Переключение UI
        document.getElementById('map-mode').classList.add('hidden');
        document.getElementById('scene-mode').classList.remove('hidden');
        
        // Сцена
        if (state.sceneManager) {
            state.sceneManager.clearBuildings();
        } else {
            state.sceneManager = new SceneManager('scene-container', state.coords);
            state.sceneManager.init();
        }
        
        state.sceneManager.coordinates = state.coords;
        state.sceneManager.setAreaSize(widthM, heightM);
        
        // Устанавливаем источник тайлов из текущего состояния
        const currentSource = state.currentMapSource || 'osm';
        state.sceneManager.tileSource = currentSource;
        this._syncLayerSwitcher('scene-layer-switcher', currentSource);
        
        state.sceneManager.loadGroundTile(bounds);
        
        // Создание мешей
        state.buildingMesh = new BuildingMesh(state.coords);
        const meshes = state.buildingMesh.createMeshes(buildings);
        
        const group = state.sceneManager.getBuildingsGroup();
        for (const mesh of meshes) {
            group.add(mesh);
        }
        
        // Инициализация инструментов
        this._initTools();
        this._initInsolation();
        this._initProjectIO();
        this._initViewControls();
        
        // Загрузка измерений с карты
        this._initMeasureRenderer();
        
        // Связываем MeasureTool с MeasureRenderer3D
        if (state.measureTool && state.measureRenderer3D) {
            state.measureTool.setRenderer(state.measureRenderer3D);
        }
        
        // Обновление UI
        const residentialCount = buildings.filter(b => b.properties.isResidential).length;
        document.getElementById('building-count').textContent = 
            `${meshes.length} (жилых: ${residentialCount})`;
        
        btn.textContent = 'Загрузить область';
        btn.disabled = false;
        
        // Событие
        bus.emit('scene:loaded', { 
            bounds, 
            buildingCount: meshes.length,
            residentialCount 
        });
        
        console.log(`[App] Загружено: ${meshes.length} зданий`);
    }
    
    /**
     * Возврат к карте
     */
    onBackClick() {
        const { state, bus } = this;
        
        document.getElementById('scene-mode').classList.add('hidden');
        document.getElementById('map-mode').classList.remove('hidden');
        
        // Закрываем карточку
        bus.emit('building:deselected');
        
        // Сброс UI режима выбора
        const btn = document.getElementById('select-mode-btn');
        btn.textContent = 'Изменить область';
        btn.classList.remove('active');
        state.selectModeActive = false;
        
        if (state.areaSelector) {
            state.areaSelector.disableDrawing();
        }
        
        document.getElementById('load-btn').textContent = 'Обновить область';
        this._updateLoadButton();
        
        // Очистка инсоляции
        if (state.insolationGrid) {
            state.insolationGrid.clearGrid();
        }
        if (state.insolationCalculator) {
            state.insolationCalculator.hideRays();
        }
        if (state.violationHighlighter) {
            state.violationHighlighter.clearAllHighlights();
            state.violationHighlighter.clearBaseline();
        }
        if (state.solarPotential) {
            state.solarPotential.clear();
        }
        
        // Очистка ветра
        this._removeWindOverlay();
        
        // Очистка Solar Radiation  // <-- ДОБАВЛЕНО
        if (this.controllers.solarRadiation?.solarRadiation) {
            this.controllers.solarRadiation.solarRadiation.clearVisualization();
        }
        
        // Сброс состояния
        state.resetSceneState();
        this._updateCoordsDisplay();
        
        // Отключение инструментов
        if (state.moveTool) state.moveTool.disable();
        if (state.drawTool) state.drawTool.disable();
        
        bus.emit('scene:cleared');
    }
    
    /**
     * Инициализация инструментов редактирования
     */
    _initTools() {
        const { state, bus } = this;
        const sm = state.sceneManager;
        
        // SelectTool
        state.selectTool = new SelectTool(sm, {
            onSelect: (data, mesh) => {
                // Проверяем что data не null (клик на пустое место)
                if (!data) {
                    if (state.solarPotential) {
                        state.solarPotential.deselect();
                    }
                    if (state.measureRenderer3D) {
                        state.measureRenderer3D.deselect();
                    }
                    return;
                }
                
                // Измерения
                if (data.type === 'measurement' && state.measureRenderer3D) {
                    state.measureRenderer3D.select(data.measureId);
                    bus.emit('measurement:selected', { id: data.measureId, data });
                    return;
                }
                
                if (data.subtype === 'solar-potential' && state.solarPotential) {
                    state.solarPotential.showPanel();
                    state.solarPotential.select();
                    return;
                }
                if (state.solarPotential) {
                    state.solarPotential.deselect();
                }
                if (state.measureRenderer3D) {
                    state.measureRenderer3D.deselect();
                }
                bus.emit('building:selected', { data, mesh });
            },
            onMultiSelect: (meshes) => {
                if (state.solarPotential) {
                    state.solarPotential.deselect();
                }
                if (state.measureRenderer3D) {
                    state.measureRenderer3D.deselect();
                }
                bus.emit('building:multiselect', { meshes });
            }
        });
        
        // HeightEditor
        state.heightEditor = new HeightEditor(sm, {
            onChange: (mesh, height) => {
                bus.emit('building:changed', { mesh, changeType: 'height', height });
            },
            onComplete: (mesh, height) => {
                bus.emit('building:changed', { mesh, changeType: 'height-complete', height });
            }
        });
        
        // EditorToolbar
        state.editorToolbar = new EditorToolbar({
            onChange: (tool, prevTool) => this._onToolChange(tool, prevTool)
        });
        
        // DrawTool
        state.drawTool = new DrawTool(sm, state.coords, {
            onCreate: (mesh) => this._onBuildingCreated(mesh)
        });
        
        // RectTool
        state.rectTool = new RectTool(sm, state.coords, {
            onCreate: (mesh) => this._onBuildingCreated(mesh)
        });
        
        // MoveTool
        state.moveTool = new MoveTool(sm, {
            onChange: (mesh) => {
                bus.emit('building:changed', { mesh, changeType: 'move' });
            },
            onMove: (mesh) => {
                if (state.insolationGrid) {
                    state.insolationGrid.syncWithMesh(mesh);
                }
                bus.emit('building:changed', { mesh, changeType: 'moving' });
            }
        });
        
        // Compass
        state.compass = new Compass();
        sm.controls.addEventListener('change', () => {
            if (state.compass) {
                state.compass.updateFromControls(sm.controls);
            }
        });
        setTimeout(() => {
            state.compass.init();
            state.compass.updateFromControls(sm.controls);
        }, 0);
        
        // MeasureTool
        state.measureTool = new MeasureTool(sm);
    }
    
    /**
     * Инициализация инсоляции
     */
    _initInsolation() {
        const { state } = this;
        const sm = state.sceneManager;
        
        state.insolationGrid = new InsolationGrid(sm, {
            onPointSelect: (point) => {},
            onPointDeselect: (point) => {}
        });
        
        state.insolationCalculator = new InsolationCalculator(sm);
        state.insolationCalculator.loadSunVectors('data/sun_vectors.json').then(success => {
            if (success) {
                state.insolationCalculator.setLatitude(55.75);
            }
        });
        
        state.violationHighlighter = new ViolationHighlighter(sm, {
            flashCount: 3,
            flashDuration: 200,
            warningColor: 0xff9800,
            failColor: 0xf44336
        });
        
        state.solarPotential = new SolarPotential(
            sm, state.insolationCalculator, state.insolationGrid, {
                cellSize: 12,       // 12×12м ячейки
                heightStep: 3,      // Шаг роста 3м
                maxHeight: 75,
                animationDelay: 50, // Для визуализации роста
                onProgress: (progress, iteration) => {},
                onComplete: (stats) => {
                    alert(`Потенциал рассчитан!\n\nКолонок: ${stats.columnCount}\nПлощадь: ${stats.totalArea.toFixed(0)} м²\nОбъём: ${stats.totalVolume.toFixed(0)} м³\nМакс. высота: ${stats.maxHeight.toFixed(0)} м`);
                }
            }
        );
        
        state.towerPlacer = new TowerPlacer(
            sm, state.insolationCalculator, state.insolationGrid, {
                cellSize: 6,
                minFloors: 18,
                maxFloors: 50
            }
        );
        
        state.towerPlacerUI = new TowerPlacerUI(state.towerPlacer, {
            onApply: (meshes, variant) => {}
        });
    }
    
    /**
     * Инициализация экспорта/импорта
     */
    _initProjectIO() {
        const { state } = this;
        
        state.projectExporter = new ProjectExporter(state.sceneManager, state.coords, {
            mapCenter: { lat: state.coords.centerLat, lng: state.coords.centerLon },
            mapZoom: 17
        });
        
        state.projectImporter = new ProjectImporter(
            state.sceneManager, state.coords, state.buildingMesh, {
                onImportComplete: (results) => {
                    const count = state.sceneManager.getBuildingsGroup().children.length;
                    document.getElementById('building-count').textContent = `${count} зданий`;
                },
                onError: (err) => {
                    alert(`Ошибка импорта: ${err}`);
                }
            }
        );
    }
    
    /**
     * Обработчик смены инструмента
     */
    _onToolChange(tool, prevTool) {
        const { state, bus } = this;
        
        if (tool === 'delete') {
            this._deleteSelectedBuilding();
            return;
        }
        
        // Отключаем все инструменты
        if (state.drawTool) state.drawTool.disable();
        if (state.rectTool) state.rectTool.disable();
        if (state.moveTool) state.moveTool.disable();
        if (state.heightEditor) state.heightEditor.deactivate();
        if (state.selectTool) state.selectTool.setEnabled(false);
        if (state.measureTool) state.measureTool.disable();
        
        if (state.sceneManager?.controls) {
            state.sceneManager.controls.enabled = true;
        }
        
        // Показываем панель управления видом
        document.getElementById('scene-view-controls')?.classList.remove('hidden');
        
        switch (tool) {
            case 'select':
                state.potentialMode = false;
                state.generationMode = false;
                if (state.selectTool) state.selectTool.setEnabled(true);
                break;
                
            case 'move':
                state.potentialMode = false;
                state.generationMode = false;
                bus.emit('building:deselected');
                if (state.heightEditor?.isActive()) {
                    state.heightEditor.deactivate();
                }
                if (state.moveTool) state.moveTool.enable();
                break;
                
            case 'measure':
                bus.emit('building:deselected');
                state.potentialMode = false;
                state.generationMode = false;
                if (state.measureTool) state.measureTool.enable();
                // Отключаем вращение камеры чтобы клики проходили к линейке
                if (state.sceneManager?.controls) {
                    state.sceneManager.controls.enabled = false;
                }
                // Скрываем панель управления видом
                document.getElementById('scene-view-controls')?.classList.add('hidden');
                break;
                
            case 'draw':
                bus.emit('building:deselected');
                state.potentialMode = false;
                state.generationMode = false;
                
                const drawMode = state.editorToolbar.getDrawMode();
                if (drawMode === 'rect') {
                    if (state.rectTool) state.rectTool.enable();
                } else {
                    if (state.drawTool) state.drawTool.enable();
                }
                break;
                
            case 'potential':
                bus.emit('building:deselected');
                state.potentialMode = true;
                state.generationMode = false;
                if (state.drawTool) state.drawTool.enable();
                break;
                
            case 'generate':
                bus.emit('building:deselected');
                state.potentialMode = false;
                state.generationMode = true;
                if (state.drawTool) state.drawTool.enable();
                break;
        }
        
        bus.emit('tool:changed', { tool, prevTool });
    }
    
    /**
     * Обработчик создания здания
     */
    _onBuildingCreated(mesh) {
        const { state, bus } = this;
        
        console.log(`[App] Создан полигон: ${mesh.userData.id}`);
        
        // Solar Potential режим
        if (state.potentialMode) {
            const points = mesh.userData.basePoints;
            state.sceneManager.getBuildingsGroup().remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            
            state.potentialMode = false;
            state.editorToolbar.setTool('select');
            
            if (points?.length >= 3) {
                state.solarPotential.showSettingsAndCalculate(points);
            } else {
                alert('Недостаточно точек для расчёта');
            }
            return;
        }
        
        // Tower Generation режим
        if (state.generationMode) {
            const points = mesh.userData.basePoints;
            mesh.material.color.setHex(0x2196f3);
            mesh.material.opacity = 0.3;
            mesh.material.transparent = true;
            
            state.generationMode = false;
            state.editorToolbar.setTool('select');
            
            if (points?.length >= 3 && state.towerPlacerUI) {
                state.towerPlacerUI.show(points, mesh);
            } else {
                alert('Недостаточно точек для генерации');
            }
            return;
        }
        
        // Обычное создание
        state.editorToolbar.setTool('select');
        state.selectTool.select(mesh);
        bus.emit('building:selected', { data: mesh.userData, mesh });
        bus.emit('building:created', { mesh });
    }
    
    /**
     * Удаление выбранного здания
     */
    _deleteSelectedBuilding() {
        const { state, bus } = this;
        
        // Сначала проверяем выбранное измерение
        if (state.measureRenderer3D?.selectedId !== null) {
            const id = state.measureRenderer3D.selectedId;
            if (confirm(`Удалить измерение #${id}?`)) {
                state.measureRenderer3D.remove(id);
            }
            return;
        }
        
        if (!state.selectTool) return;
        
        // Собираем все выбранные здания
        let meshesToDelete = [];
        
        // Множественный выбор
        if (state.selectTool.selectedItems?.size > 0) {
            meshesToDelete = Array.from(state.selectTool.selectedItems.values())
                .filter(item => item.type === 'building')
                .map(item => item.item);
        }
        // Одиночный выбор
        else if (state.selectTool.selectedMesh) {
            meshesToDelete = [state.selectTool.selectedMesh];
        }
        
        if (meshesToDelete.length === 0) {
            alert('Сначала выберите здание или измерение');
            return;
        }
        
        // Подтверждение
        const confirmMsg = meshesToDelete.length === 1 
            ? `Удалить здание ${meshesToDelete[0].userData.id}?`
            : `Удалить ${meshesToDelete.length} зданий?`;
        
        if (!confirm(confirmMsg)) return;
        
        if (state.moveTool) state.moveTool.forceReset();
        
        const group = state.sceneManager.getBuildingsGroup();
        const deletedIds = [];
        
        for (const mesh of meshesToDelete) {
            const meshId = mesh.userData.id;
            deletedIds.push(meshId);
            
            // Очистка инсоляционной сетки для этого здания
            if (state.insolationGrid) {
                state.insolationGrid.removeGridForMesh(mesh);
                
                if (state.insolationGrid.isMeshActive(mesh)) {
                    state.lastCalculatedPoints = null;
                    state.lastActiveMeshes = null;
                    state.lastCalculationResults = null;
                    bus.emit('insolation:cleared');
                }
            }
            
            // Удаление меша
            group.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(m => m.dispose());
                } else {
                    mesh.material.dispose();
                }
            }
        }
        
        // Сбрасываем кэш инсоляции
        if (state.insolationCalculator) {
            state.insolationCalculator.invalidateObstaclesCache();
        }
        
        state.selectTool.deselect();
        bus.emit('building:deselected');
        
        console.log(`[App] Удалено ${deletedIds.length} зданий:`, deletedIds);
        
        for (const meshId of deletedIds) {
            bus.emit('building:deleted', { meshId });
        }
    }
    
    // ============================================
    // UI Helpers
    // ============================================
    
    _updateLoadButton() {
        const loadBtn = document.getElementById('load-btn');
        if (loadBtn && this.state.areaSelector) {
            loadBtn.disabled = !this.state.areaSelector.isValid();
        }
    }
    
    _updateCoordsDisplay(lat, lon) {
        let display = document.getElementById('coords-display');
        
        if (!display) {
            display = document.createElement('div');
            display.id = 'coords-display';
            display.className = 'coords-display hidden';
            document.body.appendChild(display);
        }
        
        if (lat !== undefined && lon !== undefined) {
            const latDir = lat >= 0 ? 'N' : 'S';
            const lonDir = lon >= 0 ? 'E' : 'W';
            display.textContent = `${latDir} ${Math.abs(lat).toFixed(5)}°, ${lonDir} ${Math.abs(lon).toFixed(5)}°`;
            display.classList.remove('hidden');
        } else {
            display.classList.add('hidden');
        }
    }
    
    _removeWindOverlay() {
        const { state } = this;
        if (state.windOverlay) {
            state.sceneManager.scene.remove(state.windOverlay);
            if (state.windOverlay.material.map) {
                state.windOverlay.material.map.dispose();
            }
            state.windOverlay.material.dispose();
            state.windOverlay.geometry.dispose();
            state.windOverlay = null;
            state.windOverlayVisible = false;
        }
    }
    
    // ============================================
    // Debug helpers
    // ============================================
    
    _exposeDebugGlobals() {
        // Для отладки в консоли
        window.app = this;
        window.bus = this.bus;
        
        // Совместимость со старым кодом
        Object.defineProperty(window, 'sceneManager', {
            get: () => this.state.sceneManager
        });
        Object.defineProperty(window, 'coords', {
            get: () => this.state.coords
        });
        Object.defineProperty(window, 'selectTool', {
            get: () => this.state.selectTool
        });
        Object.defineProperty(window, 'insolationGrid', {
            get: () => this.state.insolationGrid
        });
        Object.defineProperty(window, 'insolationCalculator', {
            get: () => this.state.insolationCalculator
        });
    }
}

export { App };