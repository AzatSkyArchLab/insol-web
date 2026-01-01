/**
 * TowerEvolutionUI.js
 * UI для эволюционной оптимизации с визуальным сравнением вариантов
 */

export class TowerEvolutionUI {
    constructor(optimizer) {
        this.optimizer = optimizer;
        this.panel = null;
        this.isVisible = false;
        
        this._createPanel();
        console.log('[TowerEvolutionUI] Создан');
    }
    
    _createPanel() {
        this.panel = document.createElement('div');
        this.panel.id = 'tower-evolution-panel';
        this.panel.innerHTML = `
            <style>
                #tower-evolution-panel {
                    position: fixed;
                    top: 60px;
                    right: 20px;
                    width: 380px;
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    color: #eee;
                    z-index: 10000;
                    display: none;
                    overflow: hidden;
                }
                #tower-evolution-panel.visible { display: block; }
                
                .tep-header {
                    background: linear-gradient(90deg, #e94560, #ff6b6b);
                    padding: 12px 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: move;
                }
                .tep-header h3 { margin: 0; font-size: 14px; font-weight: 600; }
                .tep-close { background: none; border: none; color: white; font-size: 20px; cursor: pointer; }
                
                .tep-content { padding: 12px; max-height: calc(100vh - 140px); overflow-y: auto; }
                
                .tep-section {
                    margin-bottom: 12px;
                    padding: 10px;
                    background: rgba(255,255,255,0.05);
                    border-radius: 8px;
                }
                .tep-section-title {
                    font-size: 10px;
                    color: #0f9b8e;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    margin-bottom: 8px;
                    font-weight: 600;
                }
                
                .tep-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
                .tep-label { font-size: 11px; color: #aaa; }
                
                .tep-input, .tep-select {
                    padding: 6px 10px;
                    background: #0f3460;
                    border: 1px solid #1a1a2e;
                    border-radius: 4px;
                    color: #fff;
                    font-size: 11px;
                }
                .tep-input { width: 60px; text-align: right; }
                .tep-select { width: 120px; }
                
                .tep-btn {
                    width: 100%;
                    padding: 10px;
                    border: none;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    margin-bottom: 6px;
                }
                .tep-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .tep-btn-primary { background: linear-gradient(90deg, #e94560, #ff6b6b); color: white; }
                .tep-btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 15px rgba(233,69,96,0.4); }
                .tep-btn-secondary { background: #0f3460; color: #fff; }
                .tep-btn-success { background: linear-gradient(90deg, #27ae60, #2ecc71); color: white; }
                
                .tep-progress-container {
                    display: none;
                    margin: 10px 0;
                }
                .tep-progress-container.active { display: block; }
                .tep-progress {
                    height: 8px;
                    background: #0f3460;
                    border-radius: 4px;
                    overflow: hidden;
                }
                .tep-progress-bar {
                    height: 100%;
                    background: linear-gradient(90deg, #0f9b8e, #4ecdc4);
                    width: 0%;
                    transition: width 0.15s;
                }
                .tep-progress-text {
                    font-size: 10px;
                    color: #888;
                    text-align: center;
                    margin-top: 4px;
                }
                
                /* Варианты */
                .tep-variants-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                    margin-top: 8px;
                }
                .tep-variant-card {
                    background: rgba(0,0,0,0.3);
                    border-radius: 8px;
                    padding: 10px;
                    cursor: pointer;
                    border: 2px solid transparent;
                    transition: all 0.2s;
                }
                .tep-variant-card:hover { background: rgba(0,0,0,0.5); }
                .tep-variant-card.active { border-color: #0f9b8e; background: rgba(15,155,142,0.15); }
                .tep-variant-card.best { border-color: #ffe66d; }
                
                .tep-variant-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }
                .tep-variant-name { font-size: 11px; font-weight: 600; }
                .tep-variant-rank {
                    font-size: 9px;
                    padding: 2px 6px;
                    border-radius: 10px;
                    background: #0f9b8e;
                }
                .tep-variant-card.best .tep-variant-rank { background: #ffe66d; color: #000; }
                
                .tep-variant-gfa {
                    font-size: 16px;
                    font-weight: 700;
                    color: #ff6b6b;
                    text-align: center;
                    margin: 6px 0;
                }
                
                /* Круговая диаграмма */
                .tep-pie-container {
                    display: flex;
                    justify-content: center;
                    margin: 6px 0;
                }
                .tep-pie {
                    width: 60px;
                    height: 60px;
                    border-radius: 50%;
                    position: relative;
                }
                
                .tep-variant-stats {
                    display: flex;
                    justify-content: space-around;
                    font-size: 9px;
                    color: #888;
                    margin-top: 6px;
                }
                .tep-variant-stat { text-align: center; }
                .tep-variant-stat-value { font-size: 11px; font-weight: 600; color: #fff; }
                
                /* Легенда типов */
                .tep-legend {
                    display: flex;
                    justify-content: center;
                    gap: 12px;
                    margin-top: 8px;
                    padding-top: 8px;
                    border-top: 1px solid rgba(255,255,255,0.1);
                }
                .tep-legend-item {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 9px;
                    color: #888;
                }
                .tep-legend-color {
                    width: 10px;
                    height: 10px;
                    border-radius: 2px;
                }
                
                /* Текущий вариант */
                .tep-current {
                    background: rgba(15,155,142,0.1);
                    border: 1px solid #0f9b8e;
                    border-radius: 8px;
                    padding: 12px;
                    margin-bottom: 10px;
                }
                .tep-current-title {
                    font-size: 12px;
                    font-weight: 600;
                    margin-bottom: 8px;
                    color: #0f9b8e;
                }
                .tep-current-stats {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 8px;
                }
                .tep-current-stat {
                    text-align: center;
                    padding: 8px;
                    background: rgba(0,0,0,0.2);
                    border-radius: 6px;
                }
                .tep-current-stat-label { font-size: 9px; color: #888; }
                .tep-current-stat-value { font-size: 14px; font-weight: 700; margin-top: 2px; }
                .tep-current-stat-value.gfa { color: #ff6b6b; }
                .tep-current-stat-value.area { color: #ffe66d; }
                .tep-current-stat-value.count { color: #4ecdc4; }
                
                .tep-no-variants {
                    text-align: center;
                    padding: 30px;
                    color: #666;
                    font-size: 11px;
                }
            </style>
            
            <div class="tep-header">
                <h3>🏗️ Tower Evolution</h3>
                <button class="tep-close" id="tep-close">×</button>
            </div>
            
            <div class="tep-content">
                <!-- Параметры -->
                <div class="tep-section">
                    <div class="tep-section-title">Параметры генерации</div>
                    <div class="tep-row">
                        <span class="tep-label">Количество вариантов</span>
                        <input type="number" class="tep-input" id="tep-variants-count" value="5" min="2" max="10">
                    </div>
                    <div class="tep-row">
                        <span class="tep-label">Итераций на вариант</span>
                        <input type="number" class="tep-input" id="tep-iterations" value="200" min="50" max="1000" step="50">
                    </div>
                    <div class="tep-row">
                        <span class="tep-label">Критерий оптимизации</span>
                        <select class="tep-select" id="tep-criterion">
                            <option value="gfa">Макс GFA</option>
                            <option value="count">Макс башен</option>
                            <option value="area">Макс площадь</option>
                        </select>
                    </div>
                    <div class="tep-row">
                        <span class="tep-label">Зазор между башнями</span>
                        <input type="number" class="tep-input" id="tep-gap" value="4" min="2" max="8">
                    </div>
                </div>
                
                <!-- Генерация -->
                <div class="tep-section">
                    <button class="tep-btn tep-btn-primary" id="tep-generate">
                        🧬 Сгенерировать варианты
                    </button>
                    
                    <div class="tep-progress-container" id="tep-progress-container">
                        <div class="tep-progress">
                            <div class="tep-progress-bar" id="tep-progress-bar"></div>
                        </div>
                        <div class="tep-progress-text" id="tep-progress-text">Подготовка...</div>
                    </div>
                </div>
                
                <!-- Текущий вариант -->
                <div class="tep-section" id="tep-current-section" style="display: none;">
                    <div class="tep-current">
                        <div class="tep-current-title" id="tep-current-name">Вариант 1</div>
                        <div class="tep-current-stats">
                            <div class="tep-current-stat">
                                <div class="tep-current-stat-label">GFA</div>
                                <div class="tep-current-stat-value gfa" id="tep-current-gfa">0</div>
                            </div>
                            <div class="tep-current-stat">
                                <div class="tep-current-stat-label">Площадь</div>
                                <div class="tep-current-stat-value area" id="tep-current-area">0</div>
                            </div>
                            <div class="tep-current-stat">
                                <div class="tep-current-stat-label">Башен</div>
                                <div class="tep-current-stat-value count" id="tep-current-count">0</div>
                            </div>
                        </div>
                    </div>
                    
                    <button class="tep-btn tep-btn-success" id="tep-apply">
                        ✅ Применить как здания
                    </button>
                </div>
                
                <!-- Варианты для сравнения -->
                <div class="tep-section" id="tep-variants-section">
                    <div class="tep-section-title">Сравнение вариантов</div>
                    
                    <div class="tep-no-variants" id="tep-no-variants">
                        Нажмите "Сгенерировать варианты"<br>для создания нескольких вариантов
                    </div>
                    
                    <div class="tep-variants-grid" id="tep-variants-grid"></div>
                    
                    <div class="tep-legend" id="tep-legend" style="display: none;">
                        <div class="tep-legend-item">
                            <div class="tep-legend-color" style="background: #ff6b6b;"></div>
                            <span>Large</span>
                        </div>
                        <div class="tep-legend-item">
                            <div class="tep-legend-color" style="background: #ffe66d;"></div>
                            <span>Medium</span>
                        </div>
                        <div class="tep-legend-item">
                            <div class="tep-legend-color" style="background: #4ecdc4;"></div>
                            <span>Small</span>
                        </div>
                    </div>
                </div>
                
                <!-- Очистка -->
                <div class="tep-section">
                    <button class="tep-btn tep-btn-secondary" id="tep-clear">Очистить всё</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.panel);
        this._bindEvents();
        this._makeDraggable();
    }
    
    _bindEvents() {
        document.getElementById('tep-close').onclick = () => this.hide();
        document.getElementById('tep-generate').onclick = () => this._generate();
        document.getElementById('tep-apply').onclick = () => this._apply();
        document.getElementById('tep-clear').onclick = () => this._clear();
        
        document.getElementById('tep-gap').onchange = (e) => {
            this.optimizer.setParameters({ minGapCells: parseInt(e.target.value) });
        };
    }
    
    async _generate() {
        if (!this.optimizer.initialize()) {
            alert('Сначала финализируйте инсоляционную горку');
            return;
        }
        
        const count = parseInt(document.getElementById('tep-variants-count').value);
        const iterations = parseInt(document.getElementById('tep-iterations').value);
        const criterion = document.getElementById('tep-criterion').value;
        
        const btn = document.getElementById('tep-generate');
        const progressContainer = document.getElementById('tep-progress-container');
        const progressBar = document.getElementById('tep-progress-bar');
        const progressText = document.getElementById('tep-progress-text');
        
        btn.disabled = true;
        btn.textContent = '⏳ Генерация...';
        progressContainer.classList.add('active');
        
        try {
            await this.optimizer.generateVariants(count, iterations, criterion, (data) => {
                if (data.phase === 'variant') {
                    progressBar.style.width = ((data.variantIndex / data.totalVariants) * 100) + '%';
                    progressText.textContent = data.message;
                } else if (data.phase === 'evolution') {
                    const variantPct = (data.variantIndex / data.totalVariants) * 100;
                    const iterPct = (data.iteration / data.totalIterations) * 100 / data.totalVariants;
                    progressBar.style.width = (variantPct + iterPct) + '%';
                    progressText.textContent = `${data.message} | GFA: ${(data.currentGFA / 1000).toFixed(1)}k м²`;
                } else if (data.phase === 'complete') {
                    progressBar.style.width = '100%';
                    progressText.textContent = data.message;
                }
            });
            
            this._renderVariants();
            this._updateCurrentVariant();
            
        } catch (err) {
            console.error('[TowerEvolutionUI]', err);
            alert('Ошибка: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = '🧬 Сгенерировать варианты';
            setTimeout(() => {
                progressContainer.classList.remove('active');
            }, 1000);
        }
    }
    
    _renderVariants() {
        const variants = this.optimizer.getVariants();
        const grid = document.getElementById('tep-variants-grid');
        const noVariants = document.getElementById('tep-no-variants');
        const legend = document.getElementById('tep-legend');
        const currentSection = document.getElementById('tep-current-section');
        
        if (variants.length === 0) {
            noVariants.style.display = 'block';
            grid.innerHTML = '';
            legend.style.display = 'none';
            currentSection.style.display = 'none';
            return;
        }
        
        noVariants.style.display = 'none';
        legend.style.display = 'flex';
        currentSection.style.display = 'block';
        
        const currentIdx = this.optimizer.currentVariantIndex;
        
        grid.innerHTML = variants.map((v, i) => {
            const isActive = i === currentIdx;
            const isBest = i === 0;
            const pie = this._createPieChart(v.metrics.byType, v.metrics.count);
            
            return `
                <div class="tep-variant-card ${isActive ? 'active' : ''} ${isBest ? 'best' : ''}" data-index="${i}">
                    <div class="tep-variant-header">
                        <span class="tep-variant-name">${v.name}</span>
                        <span class="tep-variant-rank">${isBest ? '🏆 #1' : '#' + v.rank}</span>
                    </div>
                    <div class="tep-variant-gfa">${(v.metrics.gfa / 1000).toFixed(1)}k м²</div>
                    <div class="tep-pie-container">${pie}</div>
                    <div class="tep-variant-stats">
                        <div class="tep-variant-stat">
                            <div class="tep-variant-stat-value">${v.metrics.count}</div>
                            <div>башен</div>
                        </div>
                        <div class="tep-variant-stat">
                            <div class="tep-variant-stat-value">${(v.metrics.area / 1000).toFixed(1)}k</div>
                            <div>площадь</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        // Клики по карточкам
        grid.querySelectorAll('.tep-variant-card').forEach(card => {
            card.onclick = () => {
                const idx = parseInt(card.dataset.index);
                this.optimizer.loadVariant(idx);
                this._renderVariants();
                this._updateCurrentVariant();
            };
        });
    }
    
    _createPieChart(byType, total) {
        if (total === 0) {
            return '<div class="tep-pie" style="background: #333;"></div>';
        }
        
        const large = byType.Large || 0;
        const medium = byType.Medium || 0;
        const small = byType.Small || 0;
        
        const pctLarge = (large / total) * 100;
        const pctMedium = (medium / total) * 100;
        const pctSmall = (small / total) * 100;
        
        // Conic gradient для круговой диаграммы
        const gradient = `conic-gradient(
            #ff6b6b 0% ${pctLarge}%,
            #ffe66d ${pctLarge}% ${pctLarge + pctMedium}%,
            #4ecdc4 ${pctLarge + pctMedium}% 100%
        )`;
        
        return `
            <div class="tep-pie" style="background: ${gradient};" title="Large: ${large}, Medium: ${medium}, Small: ${small}"></div>
        `;
    }
    
    _updateCurrentVariant() {
        const v = this.optimizer.getCurrentVariant();
        if (!v) return;
        
        document.getElementById('tep-current-name').textContent = v.name + (v.rank === 1 ? ' 🏆' : '');
        document.getElementById('tep-current-gfa').textContent = (v.metrics.gfa / 1000).toFixed(1) + 'k м²';
        document.getElementById('tep-current-area').textContent = (v.metrics.area / 1000).toFixed(1) + 'k м²';
        document.getElementById('tep-current-count').textContent = v.metrics.count;
    }
    
    _apply() {
        if (this.optimizer.towers.length === 0) {
            alert('Сначала выберите вариант');
            return;
        }
        
        const v = this.optimizer.getCurrentVariant();
        const name = v ? v.name : 'текущий вариант';
        
        if (!confirm(`Применить ${name} (${this.optimizer.towers.length} башен) как здания?\n\nОни станут обычными зданиями, которые можно перемещать и редактировать.`)) {
            return;
        }
        
        const meshes = this.optimizer.applyAsBuildings();
        
        if (meshes.length > 0) {
            alert(`✅ Создано ${meshes.length} зданий!\n\nТеперь их можно выбирать, перемещать и изменять высоту.`);
            this._renderVariants();
            document.getElementById('tep-current-section').style.display = 'none';
        }
    }
    
    _clear() {
        if (confirm('Очистить все варианты и башни?')) {
            this.optimizer.reset();
            this._renderVariants();
            document.getElementById('tep-current-section').style.display = 'none';
        }
    }
    
    _makeDraggable() {
        const header = this.panel.querySelector('.tep-header');
        let dragging = false, startX, startY, startL, startT;
        
        header.onmousedown = (e) => {
            if (e.target.classList.contains('tep-close')) return;
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = this.panel.getBoundingClientRect();
            startL = rect.left;
            startT = rect.top;
            e.preventDefault();
        };
        
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            this.panel.style.left = (startL + e.clientX - startX) + 'px';
            this.panel.style.top = (startT + e.clientY - startY) + 'px';
            this.panel.style.right = 'auto';
        });
        
        document.addEventListener('mouseup', () => { dragging = false; });
    }
    
    show() {
        this.panel.classList.add('visible');
        this.isVisible = true;
        this._renderVariants();
    }
    
    hide() {
        this.panel.classList.remove('visible');
        this.isVisible = false;
    }
    
    toggle() {
        this.isVisible ? this.hide() : this.show();
    }
}