/**
 * ============================================
 * AppState.js
 * Централизованное состояние приложения
 * ============================================
 * 
 * Все переменные состояния в одном месте.
 * Контроллеры читают и пишут сюда.
 */

class AppState {
    constructor() {
        // ============================================
        // Core — ядро приложения
        // ============================================
        
        /** @type {Coordinates|null} */
        this.coords = null;
        
        /** @type {MapEngine|null} */
        this.mapEngine = null;
        
        /** @type {SceneManager|null} */
        this.sceneManager = null;
        
        /** @type {Object|null} - выбранные границы области */
        this.selectedBounds = null;
        
        // ============================================
        // Loaders — загрузчики данных
        // ============================================
        
        /** @type {BuildingLoader|null} */
        this.buildingLoader = null;
        
        /** @type {BuildingMesh|null} */
        this.buildingMesh = null;
        
        // ============================================
        // Map Mode — режим карты
        // ============================================
        
        /** @type {AreaSelector|null} */
        this.areaSelector = null;
        
        /** @type {boolean} */
        this.selectModeActive = false;
        
        // ============================================
        // Editor Tools — инструменты редактирования
        // ============================================
        
        /** @type {SelectTool|null} */
        this.selectTool = null;
        
        /** @type {MoveTool|null} */
        this.moveTool = null;
        
        /** @type {DrawTool|null} */
        this.drawTool = null;
        
        /** @type {RectTool|null} */
        this.rectTool = null;
        
        /** @type {HeightEditor|null} */
        this.heightEditor = null;
        
        /** @type {EditorToolbar|null} */
        this.editorToolbar = null;
        
        /** @type {Compass|null} */
        this.compass = null;
        
        // ============================================
        // Insolation — инсоляция
        // ============================================
        
        /** @type {InsolationGrid|null} */
        this.insolationGrid = null;
        
        /** @type {InsolationCalculator|null} */
        this.insolationCalculator = null;
        
        /** @type {ViolationHighlighter|null} */
        this.violationHighlighter = null;
        
        /** @type {Array|null} - последние рассчитанные точки */
        this.lastCalculatedPoints = null;
        
        /** @type {Array|null} - последние активные меши */
        this.lastActiveMeshes = null;
        
        /** @type {Array|null} - результаты последнего расчёта */
        this.lastCalculationResults = null;
        
        /** @type {number|null} - индекс выбранного результата */
        this.selectedResultIndex = null;
        
        // ============================================
        // Solar Potential — солнечный потенциал
        // ============================================
        
        /** @type {SolarPotential|null} */
        this.solarPotential = null;
        
        /** @type {boolean} */
        this.potentialMode = false;
        
        // ============================================
        // Tower Generation — генерация башен
        // ============================================
        
        /** @type {TowerPlacer|null} */
        this.towerPlacer = null;
        
        /** @type {TowerPlacerUI|null} */
        this.towerPlacerUI = null;
        
        /** @type {boolean} */
        this.generationMode = false;
        
        // ============================================
        // Wind Analysis — ветровой анализ
        // ============================================
        
        /** @type {WindCFD|null} */
        this.windCFD = null;
        
        /** @type {THREE.Mesh|null} */
        this.windOverlay = null;
        
        /** @type {boolean} */
        this.windOverlayVisible = false;
        
        // ============================================
        // Project I/O — экспорт/импорт
        // ============================================
        
        /** @type {ProjectExporter|null} */
        this.projectExporter = null;
        
        /** @type {ProjectImporter|null} */
        this.projectImporter = null;
        
        // ============================================
        // Future: Underlays — DXF подложки
        // ============================================
        
        /** @type {UnderlayManager|null} */
        this.underlayManager = null;
    }
    
    /**
     * Проверка готовности сцены
     * @returns {boolean}
     */
    isSceneReady() {
        return this.sceneManager !== null && this.coords !== null;
    }
    
    /**
     * Проверка готовности инсоляции
     * @returns {boolean}
     */
    isInsolationReady() {
        return this.insolationCalculator !== null && 
               this.insolationCalculator.isReady();
    }
    
    /**
     * Получить группу зданий
     * @returns {THREE.Group|null}
     */
    getBuildingsGroup() {
        return this.sceneManager?.getBuildingsGroup() || null;
    }
    
    /**
     * Сброс состояния сцены (при возврате к карте)
     */
    resetSceneState() {
        this.lastCalculatedPoints = null;
        this.lastActiveMeshes = null;
        this.lastCalculationResults = null;
        this.selectedResultIndex = null;
        this.potentialMode = false;
        this.generationMode = false;
        this.windOverlayVisible = false;
    }
}

export { AppState };
