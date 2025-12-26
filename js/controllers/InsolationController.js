/**
 * ============================================
 * InsolationController.js
 * Управление инсоляционным анализом
 * ============================================
 */

import { CellFeaturesManager } from '../insolation/CellFeaturesManager.js';

class InsolationController {
    /**
     * @param {App} app - главный класс приложения
     */
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.bus = app.bus;
        
        this._bindEvents();
        this._bindBusEvents();
        
        console.log('[InsolationController] Создан');
    }
    
    /**
     * Привязка DOM-событий
     */
    _bindEvents() {
        document.getElementById('insolation-grid-btn')
            .addEventListener('click', () => this.onGridClick());
        
        document.getElementById('select-all-points-btn')
            .addEventListener('click', () => this.onSelectAllPointsClick());
        
        document.getElementById('calculate-insolation-btn')
            .addEventListener('click', () => this.onCalculateClick());
        
        document.getElementById('insolation-results-close')
            .addEventListener('click', () => this.hideResults());
        
        document.getElementById('toggle-rays-btn')
            .addEventListener('click', () => this.onToggleRaysClick());
        
        document.getElementById('toggle-all-rays-btn')
            .addEventListener('click', () => this.onToggleAllRaysClick());
        
        // Обработчик изменения типа элементов
        document.getElementById('grid-features-select')
            .addEventListener('change', (e) => this.onFeaturesSelectChange(e.target.value));
        
        // Слайдеры глубины
        document.getElementById('grid-window-depth')
            .addEventListener('input', (e) => this.onWindowDepthChange(parseFloat(e.target.value)));
        
        document.getElementById('grid-balcony-depth')
            .addEventListener('input', (e) => this.onBalconyDepthChange(parseFloat(e.target.value)));
    }
    
    /**
     * Изменение глубины окон
     */
    onWindowDepthChange(depth) {
        document.getElementById('grid-window-depth-val').textContent = depth.toFixed(2) + 'м';
        this._windowDepth = depth;
        this._updateAllFeaturesDepth();
    }
    
    /**
     * Изменение глубины балконов
     */
    onBalconyDepthChange(depth) {
        document.getElementById('grid-balcony-depth-val').textContent = depth.toFixed(1) + 'м';
        this._balconyDepth = depth;
        this._updateAllFeaturesDepth();
    }
    
    /**
     * Обновить глубину всех окон/балконов
     */
    _updateAllFeaturesDepth() {
        const { state } = this;
        if (!state.insolationGrid) return;
        
        const activeMeshes = state.insolationGrid.getActiveMeshes();
        if (activeMeshes.length === 0) return;
        
        for (const mesh of activeMeshes) {
            const featuresManager = mesh.userData._featuresManager;
            if (!featuresManager) continue;
            
            // Обновляем defaults
            if (this._windowDepth !== undefined) {
                featuresManager.defaults.windowDepth = this._windowDepth;
            }
            if (this._balconyDepth !== undefined) {
                featuresManager.defaults.balconyDepth = this._balconyDepth;
            }
            
            // Обновляем все features
            for (const [cellKey, features] of featuresManager.cellFeatures) {
                if (features.window && this._windowDepth !== undefined) {
                    features.window.depth = this._windowDepth;
                }
                if (features.balcony && this._balconyDepth !== undefined) {
                    features.balcony.depth = this._balconyDepth;
                }
            }
            
            // Перестраиваем меши
            const cells = this._getCellsForMesh(mesh);
            featuresManager.rebuildAllMeshes(cells);
            
            // Сохраняем
            mesh.userData.cellFeatures = featuresManager.toJSON();
        }
        
        // Сбрасываем кэш препятствий
        if (state.insolationCalculator) {
            state.insolationCalculator.invalidateObstaclesCache();
        }
    }
    
    /**
     * Изменение типа элементов в ячейках
     */
    onFeaturesSelectChange(featureType) {
        const { state } = this;
        
        console.log('[InsolationController] onFeaturesSelectChange:', featureType);
        
        // Показываем/скрываем контролы глубины
        const depthControls = document.getElementById('grid-depth-controls');
        if (featureType === 'none') {
            depthControls.classList.add('hidden');
        } else {
            depthControls.classList.remove('hidden');
        }
        
        if (!state.insolationGrid) {
            console.log('[InsolationController] No insolationGrid');
            return;
        }
        
        const activeMeshes = state.insolationGrid.getActiveMeshes();
        console.log('[InsolationController] Active meshes:', activeMeshes.length);
        if (activeMeshes.length === 0) return;
        
        // Применяем элементы
        this._applyFeaturesToAllMeshes(activeMeshes, featureType);
        
        // Сбрасываем кэш препятствий для пересчёта инсоляции
        if (state.insolationCalculator) {
            state.insolationCalculator.invalidateObstaclesCache();
        }
        
        // НЕ пересоздаём сетку - customGrid уже существует
        // state.insolationGrid.createGrid(activeMeshes);
    }
    
    /**
     * Привязка событий шины
     */
    _bindBusEvents() {
        // Перерасчёт при изменении здания
        this.bus.on('building:changed', ({ changeType }) => {
            if (changeType === 'height' || changeType === 'move' || changeType === 'moving') {
                this.recalculateIfActive();
            }
            
            // При завершении редактирования высоты - пересоздаём сетку
            if (changeType === 'height-complete') {
                this._onHeightComplete();
            }
        });
        
        // Очистка при удалении здания
        this.bus.on('building:deleted', () => {
            this.recalculateIfActive();
        });
        
        // Очистка при создании здания
        this.bus.on('building:created', () => {
            this.recalculateIfActive();
        });
        
        // Очистка при возврате к карте
        this.bus.on('scene:cleared', () => {
            this._resetUI();
        });
        
        // Реакция на insolation:cleared
        this.bus.on('insolation:cleared', () => {
            this._resetUI();
        });
    }
    
    /**
     * Клик по кнопке "Инсоляционная сетка"
     */
    onGridClick() {
        const { state } = this;
        
        if (!state.selectTool || !state.insolationGrid) return;
        
        const selectedMeshes = state.selectTool.getSelectedMultiple();
        
        if (selectedMeshes.length === 0) {
            alert('Сначала выберите здание');
            return;
        }
        
        const btn = document.getElementById('insolation-grid-btn');
        const selectAllBtn = document.getElementById('select-all-points-btn');
        const calcBtn = document.getElementById('calculate-insolation-btn');
        const featuresSelect = document.getElementById('grid-features-select');
        
        const activeMeshes = state.insolationGrid.getActiveMeshes();
        const isSameSelection = activeMeshes.length === selectedMeshes.length &&
            selectedMeshes.every(m => activeMeshes.includes(m));
        
        // Если та же выборка - убираем сетку
        if (isSameSelection && activeMeshes.length > 0) {
            this._clearGrid();
            return;
        }
        
        // Создаём сетку
        const points = state.insolationGrid.createGrid(selectedMeshes);
        
        if (points && points.length > 0) {
            btn.classList.add('active');
            const buildingText = selectedMeshes.length === 1 ? '' : ` (${selectedMeshes.length} зд.)`;
            btn.textContent = `Убрать сетку${buildingText}`;
            selectAllBtn.classList.remove('hidden');
            calcBtn.classList.remove('hidden');
            featuresSelect.classList.remove('hidden');
            
            // Контролы глубины скрыты по умолчанию (select = 'none')
            const depthControls = document.getElementById('grid-depth-controls');
            depthControls.classList.add('hidden');
            
            // Применяем элементы согласно текущему выбору (по умолчанию 'none' - ничего не делаем)
            const featureType = featuresSelect.value;
            if (featureType !== 'none') {
                depthControls.classList.remove('hidden');
                this._applyFeaturesToAllMeshes(selectedMeshes, featureType);
            }
        }
    }
    
    /**
     * Применить элементы ко всем ячейкам выбранных зданий
     */
    _applyFeaturesToAllMeshes(meshes, featureType) {
        const { state } = this;
        const scene = state.sceneManager?.scene;
        
        if (!scene) {
            console.error('[InsolationController] No scene available');
            return;
        }
        
        console.log('[InsolationController] _applyFeaturesToAllMeshes:', featureType, 'meshes:', meshes.length);
        console.log('[InsolationController] Scene:', scene?.type, 'uuid:', scene?.uuid?.slice(0,8), 'children:', scene?.children?.length);
        
        // Получаем текущие значения глубины из слайдеров
        const windowDepthInput = document.getElementById('grid-window-depth');
        const balconyDepthInput = document.getElementById('grid-balcony-depth');
        const windowDepth = windowDepthInput ? parseFloat(windowDepthInput.value) : 0.25;
        const balconyDepth = balconyDepthInput ? parseFloat(balconyDepthInput.value) : 1.2;
        
        for (const mesh of meshes) {
            console.log('[InsolationController] Processing mesh:', mesh.name, 'customGrid:', !!mesh.userData.customGrid);
            
            // Получаем или создаём featuresManager для здания
            let featuresManager = mesh.userData._featuresManager;
            if (!featuresManager) {
                featuresManager = new CellFeaturesManager(scene);
                mesh.userData._featuresManager = featuresManager;
                console.log('[InsolationController] Created new featuresManager');
            }
            
            if (!featuresManager) {
                console.log('[InsolationController] No featuresManager, skipping');
                continue;
            }
            
            // Устанавливаем defaults из слайдеров
            featuresManager.defaults.windowDepth = windowDepth;
            featuresManager.defaults.balconyDepth = balconyDepth;
            
            // Получаем ячейки для этого здания
            const cells = this._getCellsForMesh(mesh);
            console.log('[InsolationController] Cells for mesh:', cells.length);
            if (!cells || cells.length === 0) {
                console.log('[InsolationController] No cells, skipping');
                continue;
            }
            
            // Очищаем старые элементы
            featuresManager.removeAllWindows();
            featuresManager.removeAllBalconies();
            
            // Устанавливаем новые
            if (featureType === 'windows') {
                console.log('[InsolationController] Setting windows for', cells.length, 'cells');
                featuresManager.setAllWindows(cells);
            } else if (featureType === 'balconies') {
                console.log('[InsolationController] Setting windows+balconies for', cells.length, 'cells');
                featuresManager.setAllWindowsAndBalconies(cells);
            }
            // 'none' - ничего не делаем
            
            // Проверяем результат
            console.log('[InsolationController] After apply: featuresGroup children:', 
                featuresManager.featuresGroup.children.length,
                'parent:', featuresManager.featuresGroup.parent?.type);
            
            if (featuresManager.featuresGroup.children.length > 0) {
                const firstChild = featuresManager.featuresGroup.children[0];
                console.log('[InsolationController] First child position:', 
                    firstChild.position?.x?.toFixed(2), 
                    firstChild.position?.y?.toFixed(2), 
                    firstChild.position?.z?.toFixed(2));
            }
            
            // Сохраняем в userData
            mesh.userData.cellFeatures = featuresManager.toJSON();
            console.log('[InsolationController] Saved cellFeatures:', Object.keys(mesh.userData.cellFeatures).length);
        }
    }
    
    /**
     * Получить ячейки для здания
     */
    _getCellsForMesh(mesh) {
        const customGrid = mesh.userData.customGrid;
        console.log('[InsolationController] _getCellsForMesh: customGrid:', !!customGrid, 
            'facades:', customGrid?.facades?.length);
        if (!customGrid || !customGrid.facades) return [];
        
        const cells = [];
        const pos = mesh.position;
        const rot = mesh.rotation.z || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        
        // Собираем вершины полигона
        const vertices = [];
        for (const facade of customGrid.facades) {
            if (facade) vertices.push({ x: facade.start.x, y: facade.start.y });
        }
        
        // Вычисляем signed area для определения направления обхода
        // Положительная = против часовой стрелки (CCW), отрицательная = по часовой (CW)
        let signedArea = 0;
        for (let i = 0; i < vertices.length; i++) {
            const j = (i + 1) % vertices.length;
            signedArea += vertices[i].x * vertices[j].y;
            signedArea -= vertices[j].x * vertices[i].y;
        }
        signedArea /= 2;
        
        // Если CCW (signedArea > 0), нормаль (-dirY, dirX) направлена внутрь - нужно инвертировать
        // Если CW (signedArea < 0), нормаль (-dirY, dirX) направлена наружу
        const needFlip = signedArea > 0;
        
        console.log('[InsolationController] Polygon signed area:', signedArea.toFixed(2), 
            'winding:', signedArea > 0 ? 'CCW' : 'CW', 'needFlip:', needFlip);
        
        for (let fi = 0; fi < customGrid.facades.length; fi++) {
            const facade = customGrid.facades[fi];
            if (!facade) continue;
            
            const { start, end, verticalLines, horizontalLines, edgeLength } = facade;
            if (edgeLength < 0.01) continue;  // Пропускаем вырожденные фасады
            
            const dirX = (end.x - start.x) / edgeLength;
            const dirY = (end.y - start.y) / edgeLength;
            
            // Нормаль - перпендикуляр к направлению фасада
            // Поворот на 90° против часовой: (x, y) -> (-y, x)
            let localNx = -dirY;
            let localNy = dirX;
            
            // Инвертируем если полигон по часовой стрелке
            if (needFlip) {
                localNx = -localNx;
                localNy = -localNy;
            }
            
            const worldNx = localNx * cos - localNy * sin;
            const worldNy = localNx * sin + localNy * cos;
            const worldDirX = dirX * cos - dirY * sin;
            const worldDirY = dirX * sin + dirY * cos;
            
            for (let col = 0; col < verticalLines.length - 1; col++) {
                for (let row = 0; row < horizontalLines.length - 1; row++) {
                    const t1 = verticalLines[col];
                    const t2 = verticalLines[col + 1];
                    const z1 = horizontalLines[row];
                    const z2 = horizontalLines[row + 1];
                    
                    const tCenter = (t1 + t2) / 2;
                    const zCenter = (z1 + z2) / 2;
                    
                    const localCx = start.x + dirX * tCenter;
                    const localCy = start.y + dirY * tCenter;
                    const worldCx = localCx * cos - localCy * sin + pos.x;
                    const worldCy = localCx * sin + localCy * cos + pos.y;
                    
                    // Центр нижней границы ячейки (для балконов)
                    const localBottomCx = start.x + dirX * tCenter;
                    const localBottomCy = start.y + dirY * tCenter;
                    const bottomCenterX = localBottomCx * cos - localBottomCy * sin + pos.x;
                    const bottomCenterY = localBottomCx * sin + localBottomCy * cos + pos.y;
                    
                    const cellWidth = t2 - t1;
                    const cellHeight = z2 - z1;
                    
                    cells.push({
                        key: `${fi}-${col}-${row}`,
                        facadeIndex: fi,
                        col, row,
                        cx: worldCx, cy: worldCy, cz: zCenter,
                        cellWidth, cellHeight,
                        nx: worldNx, ny: worldNy,
                        faceDirX: worldDirX, faceDirY: worldDirY,
                        z1, z2,
                        bottomCenterX, bottomCenterY
                    });
                }
            }
        }
        
        console.log('[InsolationController] _getCellsForMesh: created', cells.length, 'cells');
        if (cells.length > 0) {
            console.log('[InsolationController] Sample cell:', cells[0]);
        }
        
        return cells;
    }
    
    /**
     * Клик по кнопке "Выбрать все точки"
     */
    onSelectAllPointsClick() {
        const { state } = this;
        
        if (!state.insolationGrid) return;
        
        const selected = state.insolationGrid.getSelectedPoints();
        const all = state.insolationGrid.getCalculationPoints();
        
        if (selected.length === all.length) {
            state.insolationGrid.deselectAll();
        } else {
            state.insolationGrid.selectAll();
        }
    }
    
    /**
     * Клик по кнопке "Рассчитать инсоляцию"
     */
    onCalculateClick() {
        const { state, bus } = this;
        
        if (!state.insolationGrid || !state.insolationCalculator) return;
        
        if (!state.insolationCalculator.isReady()) {
            alert('Солнечные векторы не загружены');
            return;
        }
        
        const selectedPoints = state.insolationGrid.getSelectedPoints();
        
        if (selectedPoints.length === 0) {
            alert('Выберите точки для расчёта');
            return;
        }
        
        const activeMeshes = state.insolationGrid.getActiveMeshes();
        
        // Сохраняем для перерасчёта
        state.lastCalculatedPoints = selectedPoints;
        state.lastActiveMeshes = activeMeshes;
        
        const calcBtn = document.getElementById('calculate-insolation-btn');
        calcBtn.textContent = 'Расчёт...';
        calcBtn.disabled = true;
        
        setTimeout(() => {
            // Сохраняем baseline для сравнения
            if (state.lastCalculationResults && state.violationHighlighter) {
                state.violationHighlighter.saveBaseline(state.lastCalculationResults);
            }
            
            // Расчёт
            const { results, stats } = state.insolationCalculator.calculatePoints(
                selectedPoints, null, 120
            );
            
            state.lastCalculationResults = results;
            
            // Обновляем точки на сетке
            results.forEach(r => {
                state.insolationGrid.setPointResult(r.point.index, r.evaluation);
            });
            
            // Проверка ухудшений
            if (state.violationHighlighter?.previousResults.size > 0) {
                const changes = state.violationHighlighter.checkAndHighlight(
                    results, activeMeshes
                );
                if (changes.degraded > 0) {
                    console.log(`[Insolation] Ухудшение: ${changes.degraded} точек`);
                }
            }
            
            this.showResults(results, stats);
            
            calcBtn.textContent = 'Рассчитать инсоляцию';
            calcBtn.disabled = false;
            
            bus.emit('insolation:calculated', { results, stats });
        }, 100);
    }
    
    /**
     * Перерасчёт если сетка активна
     */
    recalculateIfActive() {
        const { state } = this;
        
        if (!state.insolationGrid || !state.insolationCalculator) return;
        if (!state.lastCalculatedPoints || state.lastCalculatedPoints.length === 0) return;
        if (!state.lastActiveMeshes || state.lastActiveMeshes.length === 0) return;
        
        // Запоминаем состояние лучей
        const toggleBtn = document.getElementById('toggle-rays-btn');
        const toggleAllBtn = document.getElementById('toggle-all-rays-btn');
        const allRaysWereActive = toggleAllBtn?.classList.contains('active');
        const singleRaysWereActive = toggleBtn?.classList.contains('active');
        const savedResultIndex = state.selectedResultIndex;
        
        // Сохраняем baseline
        if (state.lastCalculationResults && state.violationHighlighter) {
            state.violationHighlighter.saveBaseline(state.lastCalculationResults);
        }
        
        // Расчёт
        const { results, stats } = state.insolationCalculator.calculatePoints(
            state.lastCalculatedPoints, null, 120
        );
        
        state.lastCalculationResults = results;
        
        // Обновляем точки
        results.forEach(r => {
            state.insolationGrid.setPointResult(r.point.index, r.evaluation);
        });
        
        // Проверка ухудшений
        if (state.violationHighlighter?.previousResults.size > 0) {
            state.violationHighlighter.checkAndHighlight(results, state.lastActiveMeshes);
        }
        
        // Обновляем статистику
        document.getElementById('stat-pass').textContent = stats.pass;
        document.getElementById('stat-warning').textContent = stats.warning;
        document.getElementById('stat-fail').textContent = stats.fail;
        
        // Восстанавливаем лучи
        if (allRaysWereActive) {
            state.insolationCalculator.showAllRays();
        } else if (singleRaysWereActive && savedResultIndex !== null) {
            const r = state.lastCalculationResults[savedResultIndex];
            if (r) {
                state.insolationCalculator.showRays(r.point, r.collision);
            }
        }
    }
    
    /**
     * Показать результаты расчёта
     */
    showResults(results, stats) {
        const { state } = this;
        
        document.getElementById('stat-pass').textContent = stats.pass;
        document.getElementById('stat-warning').textContent = stats.warning;
        document.getElementById('stat-fail').textContent = stats.fail;
        
        const detailsEl = document.getElementById('insolation-details');
        detailsEl.innerHTML = '';
        
        state.selectedResultIndex = null;
        
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
        
        // Создаём элементы для каждого результата
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
                detailsEl.querySelectorAll('.detail-item').forEach(el => {
                    el.classList.remove('selected');
                });
                div.classList.add('selected');
                state.selectedResultIndex = index;
                
                // Используем актуальные данные из state, а не замыкание на старые результаты
                const currentResult = state.lastCalculationResults[index];
                if (currentResult) {
                    state.insolationCalculator.showRays(currentResult.point, currentResult.collision);
                }
                
                if (toggleBtn) {
                    toggleBtn.classList.add('active');
                    toggleBtn.textContent = 'Скрыть лучи';
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
    
    /**
     * Скрыть результаты
     */
    hideResults() {
        const { state } = this;
        
        const panel = document.getElementById('insolation-results');
        panel.classList.remove('visible');
        
        setTimeout(() => {
            panel.classList.add('hidden');
        }, 300);
        
        if (state.insolationCalculator) {
            state.insolationCalculator.hideRays();
            state.insolationCalculator.hideAllRays();
        }
    }
    
    /**
     * Переключение лучей выбранной точки
     */
    onToggleRaysClick() {
        const { state } = this;
        
        if (!state.insolationCalculator) return;
        
        const btn = document.getElementById('toggle-rays-btn');
        
        if (state.selectedResultIndex !== null && state.insolationCalculator.lastResults) {
            const result = state.insolationCalculator.lastResults.results[state.selectedResultIndex];
            if (result) {
                const visible = state.insolationCalculator.toggleRays(
                    result.point, result.collision
                );
                btn.classList.toggle('active', visible);
                btn.textContent = visible ? 'Скрыть лучи' : 'Показать лучи';
            }
        } else {
            alert('Сначала выберите точку');
        }
    }
    
    /**
     * Переключение всех лучей
     */
    onToggleAllRaysClick() {
        const { state } = this;
        
        if (!state.insolationCalculator) return;
        
        const btn = document.getElementById('toggle-all-rays-btn');
        const visible = state.insolationCalculator.toggleAllRays();
        
        btn.classList.toggle('active', visible);
        btn.textContent = visible ? 'Скрыть все' : 'Все лучи';
    }
    
    // ============================================
    // Private helpers
    // ============================================
    
    /**
     * Обработчик завершения редактирования высоты
     */
    _onHeightComplete() {
        const { state } = this;
        
        // Находим меш который редактировался
        const mesh = state.selectTool?.getSelected();
        if (!mesh) return;
        
        if (state.insolationGrid?.isMeshActive(mesh)) {
            const newHeight = mesh.userData.properties?.height || 9;
            const customGrid = mesh.userData.customGrid;
            
            // Обновляем customGrid при изменении высоты
            if (customGrid) {
                for (const facade of customGrid.facades) {
                    if (!facade) continue;
                    
                    const oldMax = facade.horizontalLines[facade.horizontalLines.length - 1];
                    
                    // Фильтруем линии которые выше новой высоты
                    facade.horizontalLines = facade.horizontalLines.filter(z => z <= newHeight);
                    
                    // Обновляем верхнюю границу
                    if (facade.horizontalLines.length === 0 || 
                        facade.horizontalLines[facade.horizontalLines.length - 1] !== newHeight) {
                        facade.horizontalLines.push(newHeight);
                    }
                    
                    // Сортируем
                    facade.horizontalLines.sort((a, b) => a - b);
                }
            }
            
            // Пересоздаём сетку с сохранением customGrid
            const activeMeshes = state.insolationGrid.getActiveMeshes();
            state.insolationGrid.createGridWithCustomLayout(activeMeshes);
            
            state.lastCalculatedPoints = null;
            state.lastCalculationResults = null;
            
            if (state.insolationCalculator) {
                state.insolationCalculator.hideRays();
                state.insolationCalculator.hideAllRays();
            }
            
            this._resetRaysButtons();
            this.hideResults();
        }
        
        this.recalculateIfActive();
    }
    
    /**
     * Очистить сетку
     */
    _clearGrid() {
        const { state, bus } = this;
        
        state.insolationGrid.clearGrid();
        state.lastCalculatedPoints = null;
        state.lastCalculationResults = null;
        state.lastActiveMeshes = null;
        
        const btn = document.getElementById('insolation-grid-btn');
        const selectAllBtn = document.getElementById('select-all-points-btn');
        const calcBtn = document.getElementById('calculate-insolation-btn');
        const featuresSelect = document.getElementById('grid-features-select');
        const depthControls = document.getElementById('grid-depth-controls');
        
        btn.classList.remove('active');
        btn.textContent = 'Инсоляционная сетка';
        selectAllBtn.classList.add('hidden');
        calcBtn.classList.add('hidden');
        if (featuresSelect) featuresSelect.classList.add('hidden');
        if (depthControls) depthControls.classList.add('hidden');
        
        this.hideResults();
        
        if (state.insolationCalculator) {
            state.insolationCalculator.hideRays();
            state.insolationCalculator.hideAllRays();
        }
        
        this._resetRaysButtons();
        
        bus.emit('insolation:cleared');
    }
    
    /**
     * Сброс UI при возврате к карте
     */
    _resetUI() {
        const btn = document.getElementById('insolation-grid-btn');
        const selectAllBtn = document.getElementById('select-all-points-btn');
        const calcBtn = document.getElementById('calculate-insolation-btn');
        const featuresSelect = document.getElementById('grid-features-select');
        const depthControls = document.getElementById('grid-depth-controls');
        
        if (btn) {
            btn.classList.remove('active');
            btn.textContent = 'Инсоляционная сетка';
        }
        if (selectAllBtn) selectAllBtn.classList.add('hidden');
        if (calcBtn) calcBtn.classList.add('hidden');
        if (featuresSelect) featuresSelect.classList.add('hidden');
        if (depthControls) depthControls.classList.add('hidden');
        
        this._resetRaysButtons();
        
        const resultsPanel = document.getElementById('insolation-results');
        if (resultsPanel) {
            resultsPanel.classList.remove('visible');
            resultsPanel.classList.add('hidden');
        }
    }
    
    /**
     * Сброс кнопок лучей
     */
    _resetRaysButtons() {
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
    }
}

export { InsolationController };