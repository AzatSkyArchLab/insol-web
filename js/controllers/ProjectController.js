/**
 * ============================================
 * ProjectController.js
 * Управление экспортом/импортом проекта
 * ============================================
 */

class ProjectController {
    /**
     * @param {App} app - главный класс приложения
     */
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.bus = app.bus;
        
        this._exposeGlobalMethods();
        
        console.log('[ProjectController] Создан');
    }
    
    /**
     * Экспорт методов в window (для меню)
     */
    _exposeGlobalMethods() {
        window.exportProjectToGeoJSON = () => this.exportToGeoJSON();
        window.exportProjectToOBJ = () => this.exportToOBJ();
        window.startSolarPotential = () => this.startSolarPotential();
        window.startTowerGeneration = () => this.startTowerGeneration();
    }
    
    /**
     * Экспорт в GeoJSON
     */
    exportToGeoJSON() {
        const { state } = this;
        
        if (!state.projectExporter) {
            alert('Сначала загрузите область');
            return;
        }
        
        const timestamp = new Date().toISOString().slice(0, 10);
        state.projectExporter.downloadGeoJSON(`insol-project-${timestamp}.geojson`);
        
        this.bus.emit('project:exported', { format: 'geojson' });
    }
    
    /**
     * Экспорт в OBJ
     */
    exportToOBJ() {
        const { state } = this;
        
        if (!state.projectExporter) {
            alert('Сначала загрузите область');
            return;
        }
        
        const timestamp = new Date().toISOString().slice(0, 10);
        state.projectExporter.downloadOBJ(`insol-project-${timestamp}`).then(() => {
            this.bus.emit('project:exported', { format: 'obj' });
        }).catch(e => {
            alert('Ошибка: ' + e.message);
        });
    }
    
    /**
     * Запуск расчёта солнечного потенциала
     */
    startSolarPotential() {
        const { state } = this;
        
        if (!state.solarPotential || !state.insolationCalculator?.sunVectors) {
            alert('Сначала загрузите область');
            return;
        }
        
        if (!state.insolationGrid || state.insolationGrid.getCalculationPoints().length === 0) {
            alert('Сначала создайте инсоляционную сетку');
            return;
        }
        
        state.potentialMode = true;
        if (state.editorToolbar) {
            state.editorToolbar.setTool('draw');
        }
        alert('Нарисуйте полигон участка для расчёта');
    }
    
    /**
     * Запуск генерации башен
     */
    startTowerGeneration() {
        const { state } = this;
        
        if (!state.insolationCalculator?.isReady()) {
            alert('Сначала загрузите область');
            return;
        }
        
        state.generationMode = true;
        if (state.editorToolbar) {
            state.editorToolbar.setTool('generate');
        }
        alert('Нарисуйте полигон участка для застройки');
    }
}

export { ProjectController };
