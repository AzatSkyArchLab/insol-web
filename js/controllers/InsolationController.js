/**
 * ============================================
 * InsolationController.js
 * Управление инсоляционным анализом
 * ============================================
 */

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
        }
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
        
        btn.classList.remove('active');
        btn.textContent = 'Инсоляционная сетка';
        selectAllBtn.classList.add('hidden');
        calcBtn.classList.add('hidden');
        
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
        
        if (btn) {
            btn.classList.remove('active');
            btn.textContent = 'Инсоляционная сетка';
        }
        if (selectAllBtn) selectAllBtn.classList.add('hidden');
        if (calcBtn) calcBtn.classList.add('hidden');
        
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
