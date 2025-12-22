/**
 * ============================================
 * InsolationCalculator.js
 * Расчёт инсоляции по ГОСТ Р 57795-2017
 * ============================================
 */

class InsolationCalculator {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        
        // Константы ГОСТ Р 57795-2017
        this.INTERRUPTED_PENALTY_MINUTES = 30;
        this.MIN_PERIOD_FOR_INTERRUPTED = 60;
        this.GAP_PENALTY_MINUTES = 10;
        this.QUARTIROGRAPHY_TOLERANCE = 30;
        
        // Параметры
        this.maxRayDistance = 500.0;
        this.defaultNormative = 120;
        this.freeRayLength = 100.0;
        
        // Данные солнечных векторов
        this.sunVectorsData = null;
        this.sunVectors = [];
        this.timeStepMinutes = 10;
        this.currentLatitude = null;
        
        // Raycaster
        this.raycaster = new THREE.Raycaster();
        
        // Визуализация лучей
        this.raysGroup = null;
        this.allRaysGroups = [];
        this.raysVisible = false;
        this.allRaysVisible = false;
        
        // Результаты
        this.lastResults = null;
        
        console.log('[InsolationCalculator] Создан');
    }
    
    /**
     * Получить актуальную группу зданий
     */
    _getBuildingsGroup() {
        return this.sceneManager.getBuildingsGroup();
    }
    
    /**
     * Загрузить данные солнечных векторов из JSON
     */
    async loadSunVectors(jsonPath) {
        try {
            const response = await fetch(jsonPath);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            this.sunVectorsData = await response.json();
            
            const latitudes = Object.keys(this.sunVectorsData.latitudes || {});
            console.log(`[InsolationCalculator] JSON загружен. Широты: ${latitudes.join(', ')}`);
            
            return true;
        } catch (error) {
            console.error('[InsolationCalculator] Ошибка загрузки JSON:', error);
            return false;
        }
    }
    
    /**
     * Установить широту и получить векторы
     */
    setLatitude(latitude) {
        if (!this.sunVectorsData) {
            console.warn('[InsolationCalculator] JSON не загружен');
            return false;
        }
        
        const latitudes = this.sunVectorsData.latitudes || {};
        const available = Object.keys(latitudes).map(k => parseFloat(k));
        
        let closest = available[0];
        let minDiff = Math.abs(closest - latitude);
        
        for (const lat of available) {
            const diff = Math.abs(lat - latitude);
            if (diff < minDiff) {
                minDiff = diff;
                closest = lat;
            }
        }
        
        const latData = latitudes[String(closest)] || latitudes[closest];
        
        if (!latData) {
            console.warn(`[InsolationCalculator] Нет данных для широты ${latitude}`);
            return false;
        }
        
        this.currentLatitude = closest;
        this.timeStepMinutes = latData.time_step_minutes || 
                              this.sunVectorsData.metadata?.time_step_minutes || 10;
        
        this.sunVectors = (latData.vectors || []).map(v => 
            new THREE.Vector3(v[0], v[1], v[2])
        );
        
        console.log(`[InsolationCalculator] Широта: ${latitude}° → ${closest}°, векторов: ${this.sunVectors.length}`);
        
        return true;
    }
    
    /**
     * Проверить коллизии лучей с препятствиями
     */
    checkRayCollisions(point, excludeMesh = null) {
        const results = {
            blocked: [],
            free: [],
            hitDistances: [],
            hitPoints: []
        };
        
        // Собираем ВСЕ здания (актуальный список)
        const buildingsGroup = this._getBuildingsGroup();
        const obstacles = [];
        
        buildingsGroup.children.forEach(child => {
            if (child.visible && child.userData.type === 'building') {
                // Обновляем матрицы для корректного raycasting
                child.updateMatrixWorld(true);
                
                // Убеждаемся что bounding box вычислен
                if (child.geometry) {
                    if (!child.geometry.boundingBox) {
                        child.geometry.computeBoundingBox();
                    }
                    if (!child.geometry.boundingSphere) {
                        child.geometry.computeBoundingSphere();
                    }
                }
                
                obstacles.push(child);
            }
        });
        
        // Минимальная дистанция — игнорируем пересечения ближе этого
        // (чтобы не считать коллизию с фасадом, на котором стоит точка)
        const minDistance = 0.5;
        
        for (const sunVector of this.sunVectors) {
            const direction = sunVector.clone();
            
            this.raycaster.set(point, direction);
            this.raycaster.far = this.maxRayDistance;
            
            const intersects = this.raycaster.intersectObjects(obstacles, false);
            
            // Ищем первое пересечение дальше minDistance
            let validHit = null;
            for (const hit of intersects) {
                if (hit.distance >= minDistance && hit.distance <= this.maxRayDistance) {
                    validHit = hit;
                    break;
                }
            }
            
            if (validHit) {
                results.blocked.push(true);
                results.free.push(false);
                results.hitDistances.push(validHit.distance);
                results.hitPoints.push(validHit.point.clone());
            } else {
                results.blocked.push(false);
                results.free.push(true);
                results.hitDistances.push(null);
                results.hitPoints.push(null);
            }
        }
        
        return results;
    }
    
    /**
     * Найти последовательные периоды инсоляции
     */
    findConsecutivePeriods(freeIndices) {
        if (freeIndices.length === 0) {
            return { periods: [], gapPenalties: [] };
        }
        
        const periods = [];
        const gapPenalties = [];
        
        let current = [freeIndices[0]];
        let gaps = 0;
        
        for (let i = 1; i < freeIndices.length; i++) {
            const diff = freeIndices[i] - freeIndices[i - 1];
            
            if (diff === 1) {
                current.push(freeIndices[i]);
            } else if (diff === 2) {
                current.push(freeIndices[i]);
                gaps++;
            } else {
                periods.push(current);
                gapPenalties.push(gaps);
                current = [freeIndices[i]];
                gaps = 0;
            }
        }
        
        periods.push(current);
        gapPenalties.push(gaps);
        
        return { periods, gapPenalties };
    }
    
    /**
     * Оценка инсоляции по ГОСТ Р 57795-2017
     */
    evaluateInsolation(isFree, normativeMinutes = null) {
        normativeMinutes = normativeMinutes || this.defaultNormative;
        
        const freeIndices = [];
        for (let i = 0; i < isFree.length; i++) {
            if (isFree[i]) freeIndices.push(i);
        }
        
        if (freeIndices.length === 0) {
            return this._makeResult('FAIL', 'Инсоляция отсутствует', 0, normativeMinutes, false, [], 0, normativeMinutes);
        }
        
        const { periods, gapPenalties } = this.findConsecutivePeriods(freeIndices);
        
        const periodsMinutes = periods.map((p, i) => 
            p.length * this.timeStepMinutes - gapPenalties[i] * this.GAP_PENALTY_MINUTES
        );
        
        const total = periodsMinutes.reduce((a, b) => a + b, 0);
        const maxPeriod = Math.max(...periodsMinutes);
        const hasInterruption = periods.length > 1;
        
        const required = normativeMinutes + (hasInterruption ? this.INTERRUPTED_PENALTY_MINUTES : 0);
        const shortage = Math.max(0, required - total);
        
        if (hasInterruption) {
            if (maxPeriod < this.MIN_PERIOD_FOR_INTERRUPTED) {
                return this._makeResult(
                    'FAIL',
                    `Нет периода >= ${this.MIN_PERIOD_FOR_INTERRUPTED} мин (макс. ${maxPeriod} мин)`,
                    total, required, true, periodsMinutes, maxPeriod, shortage
                );
            }
        }
        
        if (total >= required) {
            const kind = hasInterruption ? `прерывистая, ${periods.length} периодов` : 'непрерывная';
            return this._makeResult(
                'PASS',
                `Выполняется (${kind})`,
                total, required, hasInterruption, periodsMinutes, maxPeriod, shortage
            );
        }
        
        if (shortage <= this.QUARTIROGRAPHY_TOLERANCE) {
            return this._makeResult(
                'WARNING',
                `Квартирография (-${shortage} мин)`,
                total, required, hasInterruption, periodsMinutes, maxPeriod, shortage
            );
        }
        
        return this._makeResult(
            'FAIL',
            `НЕ выполняется (-${shortage} мин)`,
            total, required, hasInterruption, periodsMinutes, maxPeriod, shortage
        );
    }
    
    _makeResult(status, message, total, required, hasInterruption, periodsMinutes, maxPeriod, shortage) {
        return {
            status,
            message,
            totalMinutes: total,
            requiredMinutes: required,
            hasInterruption,
            periodsMinutes,
            maxPeriodMinutes: maxPeriod,
            shortageMinutes: shortage
        };
    }
    
    /**
     * Расчёт для одной точки
     */
    calculatePoint(point, excludeMesh = null, normativeMinutes = null) {
        const collision = this.checkRayCollisions(point.position, excludeMesh);
        const evaluation = this.evaluateInsolation(collision.free, normativeMinutes);
        
        return {
            point,
            collision,
            evaluation
        };
    }
    
    /**
     * Расчёт для массива точек
     */
    calculatePoints(points, excludeMesh = null, normativeMinutes = null, onProgress = null) {
        const results = [];
        const total = points.length;
        
        for (let i = 0; i < points.length; i++) {
            const result = this.calculatePoint(points[i], excludeMesh, normativeMinutes);
            results.push(result);
            
            if (onProgress) {
                onProgress(i + 1, total, result);
            }
        }
        
        const stats = {
            total: results.length,
            pass: results.filter(r => r.evaluation.status === 'PASS').length,
            warning: results.filter(r => r.evaluation.status === 'WARNING').length,
            fail: results.filter(r => r.evaluation.status === 'FAIL').length
        };
        
        console.log(`[InsolationCalculator] Результат: PASS=${stats.pass}, WARNING=${stats.warning}, FAIL=${stats.fail}`);
        
        this.lastResults = { results, stats };
        
        return { results, stats };
    }
    
    /**
     * Визуализация лучей для одной точки
     */
    showRays(point, collision) {
        this.hideRays();
        
        this.raysGroup = new THREE.Group();
        this.raysGroup.name = 'insolation-rays-single';
        
        const freeMaterial = new THREE.LineBasicMaterial({ 
            color: 0x000000, 
            linewidth: 2 
        });
        
        const blockedMaterial = new THREE.LineBasicMaterial({ 
            color: 0xcc9999, 
            linewidth: 1,
            transparent: true,
            opacity: 0.6
        });
        
        for (let i = 0; i < this.sunVectors.length; i++) {
            const vec = this.sunVectors[i];
            const isBlocked = collision.blocked[i];
            
            let endPoint;
            if (isBlocked && collision.hitPoints[i]) {
                endPoint = collision.hitPoints[i];
            } else {
                endPoint = point.position.clone().add(vec.clone().multiplyScalar(this.freeRayLength));
            }
            
            const geometry = new THREE.BufferGeometry().setFromPoints([
                point.position,
                endPoint
            ]);
            
            const line = new THREE.Line(geometry, isBlocked ? blockedMaterial : freeMaterial);
            this.raysGroup.add(line);
        }
        
        this.scene.add(this.raysGroup);
        this.raysVisible = true;
    }
    
    /**
     * Показать лучи для всех рассчитанных точек
     */
    showAllRays() {
        this.hideAllRays();
        
        if (!this.lastResults) return;
        
        const freeMaterial = new THREE.LineBasicMaterial({ 
            color: 0x000000, 
            linewidth: 1,
            transparent: true,
            opacity: 0.4
        });
        
        const blockedMaterial = new THREE.LineBasicMaterial({ 
            color: 0xddaaaa, 
            linewidth: 1,
            transparent: true,
            opacity: 0.3
        });
        
        for (const result of this.lastResults.results) {
            const group = new THREE.Group();
            group.name = `rays-point-${result.point.index}`;
            
            for (let i = 0; i < this.sunVectors.length; i++) {
                const vec = this.sunVectors[i];
                const isBlocked = result.collision.blocked[i];
                
                let endPoint;
                if (isBlocked && result.collision.hitPoints[i]) {
                    endPoint = result.collision.hitPoints[i];
                } else {
                    endPoint = result.point.position.clone().add(vec.clone().multiplyScalar(this.freeRayLength));
                }
                
                const geometry = new THREE.BufferGeometry().setFromPoints([
                    result.point.position,
                    endPoint
                ]);
                
                const line = new THREE.Line(geometry, isBlocked ? blockedMaterial.clone() : freeMaterial.clone());
                group.add(line);
            }
            
            this.scene.add(group);
            this.allRaysGroups.push(group);
        }
        
        this.allRaysVisible = true;
        console.log(`[InsolationCalculator] Показаны лучи для ${this.lastResults.results.length} точек`);
    }
    
    /**
     * Скрыть лучи одной точки
     */
    hideRays() {
        if (this.raysGroup) {
            this.raysGroup.children.forEach(child => {
                child.geometry.dispose();
                child.material.dispose();
            });
            this.scene.remove(this.raysGroup);
            this.raysGroup = null;
        }
        this.raysVisible = false;
    }
    
    /**
     * Скрыть все лучи
     */
    hideAllRays() {
        for (const group of this.allRaysGroups) {
            group.children.forEach(child => {
                child.geometry.dispose();
                child.material.dispose();
            });
            this.scene.remove(group);
        }
        this.allRaysGroups = [];
        this.allRaysVisible = false;
    }
    
    /**
     * Переключить видимость лучей одной точки
     */
    toggleRays(point, collision) {
        if (this.raysVisible) {
            this.hideRays();
        } else {
            this.showRays(point, collision);
        }
        return this.raysVisible;
    }
    
    /**
     * Переключить видимость всех лучей
     */
    toggleAllRays() {
        if (this.allRaysVisible) {
            this.hideAllRays();
        } else {
            this.showAllRays();
        }
        return this.allRaysVisible;
    }
    
    getSunVectors() {
        return this.sunVectors;
    }
    
    isReady() {
        return this.sunVectors.length > 0;
    }
    
    getLastResults() {
        return this.lastResults;
    }
}

export { InsolationCalculator };
window.InsolationCalculator = InsolationCalculator;