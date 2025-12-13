/**
 * ============================================
 * ViolationHighlighter.js
 * Подсветка зданий с нарушением инсоляции
 * ============================================
 */

class ViolationHighlighter {
    constructor(sceneManager, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        
        // Настройки
        this.flashCount = options.flashCount || 3;
        this.flashDuration = options.flashDuration || 200;
        this.warningColor = options.warningColor || 0xff9800;
        this.failColor = options.failColor || 0xf44336;
        
        // Хранение предыдущих результатов
        this.previousResults = new Map(); // pointIndex -> { status, buildingId }
        
        // Активные подсветки (изменённые материалы)
        this.highlightedBuildings = new Map(); // meshId -> { mesh, originalColor, originalEmissive }
        this.activeAnimations = new Map(); // meshId -> animationId
        
        console.log('[ViolationHighlighter] Создан');
    }
    
    /**
     * Сохранить текущие результаты как базовые
     */
    saveBaseline(results) {
        this.previousResults.clear();
        
        if (!results) return;
        
        results.forEach(r => {
            if (r.point && r.point.index !== undefined) {
                const buildingId = r.point.buildingMesh?.userData?.id || 'unknown';
                this.previousResults.set(r.point.index, {
                    status: r.evaluation.status,
                    buildingId: buildingId
                });
            }
        });
        
        console.log(`[ViolationHighlighter] Baseline: ${this.previousResults.size} точек`);
    }
    
    /**
     * Проверить и подсветить здания с ухудшением
     */
    checkAndHighlight(newResults, activeMeshes) {
        if (!newResults || !activeMeshes || activeMeshes.length === 0) {
            return { degraded: 0, improved: 0, affectedBuildings: [] };
        }
        
        // Очищаем предыдущие подсветки
        this.clearAllHighlights();
        
        const statusPriority = { 'PASS': 0, 'WARNING': 1, 'FAIL': 2 };
        
        // Группируем ухудшения по зданиям
        const buildingDegradations = new Map(); // buildingId -> { mesh, worstLevel, count }
        
        newResults.forEach(r => {
            if (!r.point || r.point.index === undefined) return;
            
            const pointIndex = r.point.index;
            const newStatus = r.evaluation.status;
            const oldData = this.previousResults.get(pointIndex);
            
            if (oldData) {
                const oldPriority = statusPriority[oldData.status];
                const newPriority = statusPriority[newStatus];
                
                if (newPriority > oldPriority) {
                    // Ухудшение — определяем здание
                    const buildingMesh = r.point.buildingMesh;
                    if (!buildingMesh) return;
                    
                    const buildingId = buildingMesh.userData?.id || buildingMesh.uuid;
                    
                    if (!buildingDegradations.has(buildingId)) {
                        buildingDegradations.set(buildingId, {
                            mesh: buildingMesh,
                            worstLevel: newStatus,
                            count: 0
                        });
                    }
                    
                    const data = buildingDegradations.get(buildingId);
                    data.count++;
                    
                    // Обновляем худший уровень
                    if (newStatus === 'FAIL') {
                        data.worstLevel = 'FAIL';
                    }
                }
            }
        });
        
        // Подсвечиваем только пострадавшие здания
        const affectedBuildings = [];
        
        buildingDegradations.forEach((data, buildingId) => {
            this.highlightBuilding(data.mesh, data.worstLevel);
            affectedBuildings.push({
                id: buildingId,
                level: data.worstLevel,
                degradedPoints: data.count
            });
            console.log(`[ViolationHighlighter] Здание ${buildingId}: ${data.count} точек ухудшились до ${data.worstLevel}`);
        });
        
        return {
            degraded: Array.from(buildingDegradations.values()).reduce((sum, d) => sum + d.count, 0),
            improved: 0,
            affectedBuildings: affectedBuildings
        };
    }
    
    /**
     * Подсветить здание изменением цвета материала
     */
    highlightBuilding(mesh, level = 'WARNING') {
        if (!mesh || !mesh.material) return;
        
        const meshId = mesh.userData.id || mesh.uuid;
        
        // Сохраняем оригинальный цвет
        const originalColor = mesh.material.color.getHex();
        
        this.highlightedBuildings.set(meshId, {
            mesh: mesh,
            originalColor: originalColor
        });
        
        // Цвет подсветки
        const highlightColor = level === 'FAIL' ? this.failColor : this.warningColor;
        
        // Запускаем анимацию мигания
        this._flashMaterial(mesh, highlightColor, meshId);
    }
    
    /**
     * Анимация мигания через изменение цвета материала
     */
    _flashMaterial(mesh, highlightColor, meshId) {
        let flashCount = 0;
        const maxFlashes = this.flashCount;
        const duration = this.flashDuration;
        
        const data = this.highlightedBuildings.get(meshId);
        if (!data) return;
        
        const originalColor = data.originalColor;
        let isHighlighted = false;
        
        const animationId = Symbol('flash');
        this.activeAnimations.set(meshId, animationId);
        
        const flash = () => {
            // Проверяем что анимация не отменена
            if (this.activeAnimations.get(meshId) !== animationId) return;
            if (!mesh.material) return;
            
            isHighlighted = !isHighlighted;
            
            if (isHighlighted) {
                mesh.material.color.setHex(highlightColor);
                flashCount++;
            } else {
                mesh.material.color.setHex(originalColor);
            }
            
            if (flashCount >= maxFlashes && !isHighlighted) {
                // Закончили мигать — возвращаем оригинальный цвет
                mesh.material.color.setHex(originalColor);
                this.activeAnimations.delete(meshId);
                // Удаляем из списка подсвеченных
                this.highlightedBuildings.delete(meshId);
                return;
            }
            
            setTimeout(flash, duration);
        };
        
        flash();
    }
    
    /**
     * Удалить подсветку здания
     */
    removeHighlight(meshId) {
        const data = this.highlightedBuildings.get(meshId);
        if (data && data.mesh && data.mesh.material) {
            data.mesh.material.color.setHex(data.originalColor);
        }
        this.highlightedBuildings.delete(meshId);
        this.activeAnimations.delete(meshId);
    }
    
    /**
     * Удалить все подсветки
     */
    clearAllHighlights() {
        this.highlightedBuildings.forEach((data, meshId) => {
            if (data.mesh && data.mesh.material) {
                data.mesh.material.color.setHex(data.originalColor);
            }
        });
        this.highlightedBuildings.clear();
        this.activeAnimations.clear();
    }
    
    /**
     * Очистить baseline
     */
    clearBaseline() {
        this.previousResults.clear();
    }
    
    /**
     * Проверить наличие подсветок
     */
    hasActiveHighlights() {
        return this.highlightedBuildings.size > 0;
    }
    
    getHighlightCount() {
        return this.highlightedBuildings.size;
    }
}

export { ViolationHighlighter };
window.ViolationHighlighter = ViolationHighlighter;