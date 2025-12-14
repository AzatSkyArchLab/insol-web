/**
 * ============================================
 * TowerPlacerUI.js
 * UI панель для генеративного размещения
 * ============================================
 */

class TowerPlacerUI {
    constructor(towerPlacer, options = {}) {
        this.towerPlacer = towerPlacer;
        this.onApply = options.onApply || (() => {});
        
        this.panel = null;
        this.polygonPoints = null;
        this.areaMesh = null;       // Mesh полигона участка
        this.gridMesh = null;       // Mesh сетки
        this.currentVariants = [];
        this.selectedVariantIndex = -1;
    }
    
    /**
     * Показать панель
     */
    show(polygonPoints, areaMesh = null) {
        this.polygonPoints = polygonPoints;
        this.areaMesh = areaMesh;
        this.hide(); // Закрыть старую
        
        this.panel = document.createElement('div');
        this.panel.id = 'tower-placer-panel';
        this.panel.innerHTML = this._getHTML();
        this._applyStyles();
        
        document.body.appendChild(this.panel);
        
        this._bindEvents();
        
        // Показываем сетку сразу
        this._showGrid();
    }
    
    /**
     * Скрыть панель
     */
    hide() {
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
        }
        
        // Очищаем сетку
        this._hideGrid();
        
        // Очищаем превью башен
        if (this.towerPlacer) {
            this.towerPlacer._clearTempMeshes();
        }
        
        this.currentVariants = [];
        this.selectedVariantIndex = -1;
    }
    
    /**
     * Показать сетку
     */
    _showGrid() {
        this._hideGrid();
        
        if (!this.polygonPoints || !this.towerPlacer) return;
        
        const angle = parseFloat(document.getElementById('tp-grid-angle')?.value) || 0;
        this.gridMesh = this.towerPlacer.createGridVisualization(this.polygonPoints, angle);
    }
    
    /**
     * Скрыть сетку
     */
    _hideGrid() {
        if (this.gridMesh && this.towerPlacer) {
            const group = this.towerPlacer.sceneManager.getBuildingsGroup();
            group.remove(this.gridMesh);
            if (this.gridMesh.geometry) this.gridMesh.geometry.dispose();
            if (this.gridMesh.material) this.gridMesh.material.dispose();
            this.gridMesh = null;
        }
    }
    
    /**
     * Обновить угол сетки
     */
    _updateGridAngle(angle) {
        this._showGrid();
    }
    
    /**
     * HTML панели
     */
    _getHTML() {
        return `
            <div class="tp-header">
                <span>🏗 Генерация застройки</span>
                <button class="tp-close" id="tp-close">×</button>
            </div>
            
            <div class="tp-content">
                <div class="tp-section">
                    <div class="tp-label">Угол сетки: <span id="tp-angle-value">0</span>°</div>
                    <input type="range" id="tp-grid-angle" min="0" max="90" value="0" style="width: 100%;">
                </div>
                
                <div class="tp-section">
                    <div class="tp-label">Типы башен:</div>
                    <div class="tp-checkboxes">
                        <label><input type="checkbox" id="tp-type-a" checked> A: 18×18м</label>
                        <label><input type="checkbox" id="tp-type-b" checked> B: 24×18м</label>
                        <label><input type="checkbox" id="tp-type-c" checked> C: 30×18м</label>
                        <label><input type="checkbox" id="tp-type-d" checked> D: 12×12м</label>
                    </div>
                </div>
                
                <div class="tp-section">
                    <div class="tp-label">Этажность:</div>
                    <div class="tp-range-row">
                        <span>от</span>
                        <input type="number" id="tp-min-floors" value="18" min="5" max="50">
                        <span>до</span>
                        <input type="number" id="tp-max-floors" value="40" min="10" max="70">
                        <span>эт.</span>
                    </div>
                </div>
                
                <div class="tp-section">
                    <div class="tp-label">Параметры:</div>
                    <div class="tp-params">
                        <label>
                            Поколений:
                            <input type="number" id="tp-generations" value="30" min="10" max="200">
                        </label>
                        <label>
                            Популяция:
                            <input type="number" id="tp-population" value="20" min="10" max="100">
                        </label>
                    </div>
                </div>
                
                <button class="tp-button tp-start" id="tp-start">
                    ▶ Запустить генерацию
                </button>
                
                <div class="tp-progress" id="tp-progress" style="display: none;">
                    <div class="tp-progress-bar">
                        <div class="tp-progress-fill" id="tp-progress-fill"></div>
                    </div>
                    <div class="tp-progress-text" id="tp-progress-text">Поколение 0/30</div>
                    <button class="tp-button tp-cancel" id="tp-cancel">Отмена</button>
                </div>
                
                <div class="tp-results" id="tp-results" style="display: none;">
                    <div class="tp-label">Варианты:</div>
                    <div class="tp-variants" id="tp-variants"></div>
                    
                    <div class="tp-selected" id="tp-selected" style="display: none;">
                        <div class="tp-selected-info" id="tp-selected-info"></div>
                        <div class="tp-selected-actions">
                            <button class="tp-button tp-apply" id="tp-apply">✓ Применить</button>
                            <button class="tp-button tp-preview" id="tp-preview">👁 Показать</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Стили
     */
    _applyStyles() {
        this.panel.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            width: 280px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            z-index: 10000;
            overflow: hidden;
        `;
        
        const style = document.createElement('style');
        style.textContent = `
            #tower-placer-panel .tp-header {
                background: #1976d2;
                color: white;
                padding: 12px 15px;
                font-weight: 500;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            #tower-placer-panel .tp-close {
                background: none;
                border: none;
                color: white;
                font-size: 20px;
                cursor: pointer;
                opacity: 0.8;
            }
            
            #tower-placer-panel .tp-close:hover {
                opacity: 1;
            }
            
            #tower-placer-panel .tp-content {
                padding: 15px;
            }
            
            #tower-placer-panel .tp-section {
                margin-bottom: 15px;
            }
            
            #tower-placer-panel .tp-label {
                font-weight: 500;
                margin-bottom: 8px;
                color: #333;
            }
            
            #tower-placer-panel .tp-checkboxes {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 5px;
            }
            
            #tower-placer-panel .tp-checkboxes label {
                font-size: 12px;
                cursor: pointer;
            }
            
            #tower-placer-panel .tp-range-row {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            #tower-placer-panel .tp-range-row input {
                width: 50px;
                padding: 4px 6px;
                border: 1px solid #ddd;
                border-radius: 4px;
                text-align: center;
            }
            
            #tower-placer-panel .tp-params {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            
            #tower-placer-panel .tp-params label {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 12px;
            }
            
            #tower-placer-panel .tp-params input {
                width: 60px;
                padding: 4px 6px;
                border: 1px solid #ddd;
                border-radius: 4px;
                text-align: center;
            }
            
            #tower-placer-panel .tp-button {
                width: 100%;
                padding: 10px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                transition: all 0.2s;
            }
            
            #tower-placer-panel .tp-start {
                background: #4caf50;
                color: white;
            }
            
            #tower-placer-panel .tp-start:hover {
                background: #43a047;
            }
            
            #tower-placer-panel .tp-cancel {
                background: #f44336;
                color: white;
                margin-top: 10px;
            }
            
            #tower-placer-panel .tp-apply {
                background: #2196f3;
                color: white;
                flex: 1;
            }
            
            #tower-placer-panel .tp-preview {
                background: #757575;
                color: white;
                flex: 1;
            }
            
            #tower-placer-panel .tp-progress {
                margin-top: 15px;
            }
            
            #tower-placer-panel .tp-progress-bar {
                height: 8px;
                background: #e0e0e0;
                border-radius: 4px;
                overflow: hidden;
            }
            
            #tower-placer-panel .tp-progress-fill {
                height: 100%;
                background: #4caf50;
                width: 0%;
                transition: width 0.2s;
            }
            
            #tower-placer-panel .tp-progress-text {
                text-align: center;
                margin-top: 8px;
                font-size: 12px;
                color: #666;
            }
            
            #tower-placer-panel .tp-results {
                margin-top: 15px;
                border-top: 1px solid #eee;
                padding-top: 15px;
            }
            
            #tower-placer-panel .tp-variants {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                margin-bottom: 15px;
            }
            
            #tower-placer-panel .tp-variant {
                width: 45px;
                height: 55px;
                border: 2px solid #ddd;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                transition: all 0.2s;
            }
            
            #tower-placer-panel .tp-variant:hover {
                border-color: #2196f3;
            }
            
            #tower-placer-panel .tp-variant.selected {
                border-color: #2196f3;
                background: #e3f2fd;
            }
            
            #tower-placer-panel .tp-variant-num {
                font-weight: bold;
                font-size: 14px;
            }
            
            #tower-placer-panel .tp-variant-vol {
                color: #666;
            }
            
            #tower-placer-panel .tp-selected {
                background: #f5f5f5;
                padding: 10px;
                border-radius: 4px;
            }
            
            #tower-placer-panel .tp-selected-info {
                font-size: 12px;
                margin-bottom: 10px;
                line-height: 1.5;
            }
            
            #tower-placer-panel .tp-selected-actions {
                display: flex;
                gap: 8px;
            }
        `;
        
        document.head.appendChild(style);
    }
    
    /**
     * Привязка событий
     */
    _bindEvents() {
        // Закрыть
        document.getElementById('tp-close').onclick = () => this.hide();
        
        // Слайдер угла сетки
        const angleSlider = document.getElementById('tp-grid-angle');
        const angleValue = document.getElementById('tp-angle-value');
        
        angleSlider.oninput = () => {
            const angle = parseFloat(angleSlider.value);
            angleValue.textContent = angle;
            this._updateGridAngle(angle);
        };
        
        // Запустить
        document.getElementById('tp-start').onclick = () => this._startGeneration();
        
        // Отмена
        document.getElementById('tp-cancel').onclick = () => {
            this.towerPlacer.cancel();
        };
        
        // Применить
        document.getElementById('tp-apply').onclick = () => this._applySelected();
        
        // Превью
        document.getElementById('tp-preview').onclick = () => this._previewSelected();
    }
    
    /**
     * Запустить генерацию
     */
    async _startGeneration() {
        if (!this.polygonPoints) {
            alert('Нет полигона участка');
            return;
        }
        
        // Собираем параметры
        const enabledTypes = [];
        if (document.getElementById('tp-type-a').checked) enabledTypes.push('A');
        if (document.getElementById('tp-type-b').checked) enabledTypes.push('B');
        if (document.getElementById('tp-type-c').checked) enabledTypes.push('C');
        if (document.getElementById('tp-type-d').checked) enabledTypes.push('D');
        
        if (enabledTypes.length === 0) {
            alert('Выберите хотя бы один тип башни');
            return;
        }
        
        const minFloors = parseInt(document.getElementById('tp-min-floors').value) || 18;
        const maxFloors = parseInt(document.getElementById('tp-max-floors').value) || 40;
        const generations = parseInt(document.getElementById('tp-generations').value) || 30;
        const populationSize = parseInt(document.getElementById('tp-population').value) || 20;
        
        // Устанавливаем параметры
        this.towerPlacer.minFloors = minFloors;
        this.towerPlacer.maxFloors = maxFloors;
        this.towerPlacer.generations = generations;
        this.towerPlacer.populationSize = populationSize;
        
        // Показываем прогресс
        document.getElementById('tp-start').style.display = 'none';
        document.getElementById('tp-progress').style.display = 'block';
        document.getElementById('tp-results').style.display = 'none';
        
        // Callbacks
        this.towerPlacer.onProgress = (progress) => {
            const pct = (progress.generation / progress.totalGenerations) * 100;
            document.getElementById('tp-progress-fill').style.width = `${pct}%`;
            
            let text = `Поколение ${progress.generation}/${progress.totalGenerations}`;
            if (progress.bestVolume > 0) {
                text += ` | ${(progress.bestVolume / 1000).toFixed(1)}к м³`;
                text += ` | ${progress.towersCount} башен`;
                text += progress.insolationOk ? ' ✓' : ' ✗';
            }
            document.getElementById('tp-progress-text').textContent = text;
        };
        
        // Запускаем
        const result = await this.towerPlacer.evolve(this.polygonPoints, {
            generations,
            towerTypes: enabledTypes
        });
        
        // Показываем результаты
        document.getElementById('tp-progress').style.display = 'none';
        document.getElementById('tp-start').style.display = 'block';
        
        if (!result.cancelled && result.topVariants.length > 0) {
            this.currentVariants = result.topVariants;
            this._showResults();
        } else if (result.cancelled) {
            console.log('[TowerPlacerUI] Генерация отменена');
        } else {
            console.log('[TowerPlacerUI] Нет вариантов. Best:', result.best);
            alert('Не удалось разместить башни.\n\nВозможные причины:\n- Участок слишком маленький\n- Попробуйте уменьшить количество башен\n- Попробуйте другой угол сетки');
        }
    }
    
    /**
     * Показать результаты
     */
    _showResults() {
        document.getElementById('tp-results').style.display = 'block';
        
        const container = document.getElementById('tp-variants');
        container.innerHTML = '';
        
        this.currentVariants.forEach((variant, index) => {
            const div = document.createElement('div');
            div.className = 'tp-variant';
            div.innerHTML = `
                <div class="tp-variant-num">#${index + 1}</div>
                <div class="tp-variant-vol">${(variant.result.totalVolume / 1000).toFixed(0)}к</div>
            `;
            
            div.onclick = () => this._selectVariant(index);
            container.appendChild(div);
        });
        
        // Выбираем первый
        if (this.currentVariants.length > 0) {
            this._selectVariant(0);
        }
    }
    
    /**
     * Выбрать вариант
     */
    _selectVariant(index) {
        this.selectedVariantIndex = index;
        const variant = this.currentVariants[index];
        
        // Обновляем UI
        document.querySelectorAll('.tp-variant').forEach((el, i) => {
            el.classList.toggle('selected', i === index);
        });
        
        // Показываем информацию
        const info = document.getElementById('tp-selected-info');
        const result = variant.result;
        
        info.innerHTML = `
            <strong>Вариант #${index + 1}</strong><br>
            Башен: ${result.placed.length}<br>
            Объём: ${(result.totalVolume / 1000).toFixed(1)} тыс. м³<br>
            Площадь: ${(result.totalArea / 1000).toFixed(1)} тыс. м²<br>
            Угол сетки: ${variant.gridAngle.toFixed(1)}°<br>
            Инсоляция: ${result.insolationOk ? '✓ OK' : '✗ FAIL'}
        `;
        
        document.getElementById('tp-selected').style.display = 'block';
        
        // Автоматически показываем превью
        this._previewSelected();
    }
    
    /**
     * Превью выбранного варианта
     */
    _previewSelected() {
        if (this.selectedVariantIndex < 0) return;
        
        const variant = this.currentVariants[this.selectedVariantIndex];
        
        // Очищаем старые превью
        this.towerPlacer._clearTempMeshes();
        
        // Создаём сетку и меши
        const grid = this.towerPlacer.createGrid(this.polygonPoints, variant.gridAngle);
        const group = this.towerPlacer.sceneManager.getBuildingsGroup();
        
        for (const tower of variant.result.placed) {
            const mesh = this.towerPlacer.createTowerMesh(tower, grid);
            mesh.material.opacity = 0.6;
            group.add(mesh);
            this.towerPlacer.tempMeshes.push(mesh);
        }
    }
    
    /**
     * Применить выбранный вариант
     */
    _applySelected() {
        if (this.selectedVariantIndex < 0) return;
        
        const variant = this.currentVariants[this.selectedVariantIndex];
        
        // Очищаем превью
        this.towerPlacer._clearTempMeshes();
        
        // Применяем постоянно
        const meshes = this.towerPlacer.applyVariant(variant, this.polygonPoints);
        
        console.log(`[TowerPlacerUI] Применён вариант #${this.selectedVariantIndex + 1}: ${meshes.length} башен`);
        
        // Callback
        this.onApply(meshes, variant);
        
        // Закрываем панель
        this.hide();
    }
}

// ES6 экспорт
export { TowerPlacerUI };