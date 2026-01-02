/**
 * WindCFDUI.js
 * UI компоненты: стили, HTML шаблоны, создание панели
 */

/**
 * CSS стили для панели WindCFD
 */
export const PANEL_STYLES = `
    .wind-cfd-panel {
        position: fixed;
        top: 80px;
        right: 20px;
        width: 320px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        z-index: 1000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        max-height: calc(100vh - 100px);
        overflow-y: auto;
    }
    .wind-cfd-panel.hidden { display: none; }
    
    .wcfd-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid #eee;
    }
    .wcfd-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
    .wcfd-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #999;
        padding: 0;
        line-height: 1;
    }
    .wcfd-close:hover { color: #333; }
    
    .wcfd-section {
        padding: 12px 16px;
        border-bottom: 1px solid #f0f0f0;
    }
    .wcfd-section:last-child { border-bottom: none; }
    .wcfd-section.wcfd-hidden { display: none; }
    
    .wcfd-label {
        font-size: 12px;
        font-weight: 600;
        color: #666;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    
    .wcfd-buildings-info, .wcfd-domain-info, .wcfd-epw-info, .wcfd-selected-wind {
        background: #f8f9fa;
        padding: 10px;
        border-radius: 6px;
        margin-bottom: 10px;
        font-size: 13px;
    }
    
    .wcfd-btn {
        width: 100%;
        padding: 10px;
        border: 1px solid #ddd;
        background: white;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.2s;
        margin-bottom: 6px;
    }
    .wcfd-btn:hover { border-color: #4a90e2; color: #4a90e2; }
    .wcfd-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .wcfd-btn:last-child { margin-bottom: 0; }
    
    .wcfd-btn-primary {
        background: #4a90e2;
        border-color: #4a90e2;
        color: white;
    }
    .wcfd-btn-primary:hover { background: #3a7bc8; color: white; }
    .wcfd-btn-primary:disabled { background: #ccc; border-color: #ccc; }
    
    .wcfd-btn-success {
        background: #28a745;
        border-color: #28a745;
        color: white;
    }
    .wcfd-btn-success:hover { background: #218838; color: white; }
    .wcfd-btn-success:disabled { background: #ccc; border-color: #ccc; }
    
    .wcfd-btn-danger {
        background: #dc3545;
        border-color: #dc3545;
        color: white;
    }
    .wcfd-btn-danger:hover { background: #c82333; color: white; }
    
    .wcfd-help {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        background: #6c757d;
        color: white;
        border-radius: 50%;
        font-size: 10px;
        cursor: help;
        margin-left: 4px;
        position: relative;
    }
    .wcfd-help:hover { background: #4a90e2; }
    
    .wcfd-help::after,
    [data-tooltip]::after {
        content: attr(title);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        background: #333;
        color: white;
        padding: 6px 10px;
        border-radius: 4px;
        font-size: 11px;
        white-space: normal;
        width: max-content;
        max-width: 250px;
        text-align: left;
        z-index: 10000;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s, visibility 0.2s;
        pointer-events: none;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        line-height: 1.4;
        margin-bottom: 5px;
    }
    .wcfd-help:hover::after,
    [data-tooltip]:hover::after {
        opacity: 1;
        visibility: visible;
    }
    .wcfd-help::before {
        content: '';
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 5px solid transparent;
        border-top-color: #333;
        margin-bottom: -5px;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s, visibility 0.2s;
        z-index: 10001;
    }
    .wcfd-help:hover::before {
        opacity: 1;
        visibility: visible;
    }
    
    span[title] { position: relative; }
    span[title]::after {
        content: attr(title);
        position: absolute;
        bottom: 100%;
        left: 0;
        background: #333;
        color: white;
        padding: 6px 10px;
        border-radius: 4px;
        font-size: 11px;
        white-space: normal;
        width: max-content;
        max-width: 220px;
        text-align: left;
        z-index: 10000;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s, visibility 0.2s;
        pointer-events: none;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        line-height: 1.4;
        margin-bottom: 5px;
    }
    span[title]:hover::after { opacity: 1; visibility: visible; }
    
    [title] { position: relative; }
    
    .wcfd-checkbox {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        cursor: pointer;
    }
    .wcfd-checkbox input { margin: 0; }
    
    .wcfd-wind-rose {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
        margin-bottom: 10px;
    }
    
    .wcfd-wind-btn {
        padding: 8px 4px;
        border: 2px solid #ddd;
        background: white;
        border-radius: 6px;
        cursor: pointer;
        font-size: 11px;
        text-align: center;
        transition: all 0.2s;
        position: relative;
    }
    .wcfd-wind-btn:hover { border-color: #4a90e2; }
    .wcfd-wind-btn.active {
        background: #4a90e2;
        border-color: #4a90e2;
        color: white;
    }
    .wcfd-wind-btn.calculated {
        border-color: #28a745;
        background: #d4edda;
    }
    .wcfd-wind-btn.calculated::after {
        content: '✓';
        position: absolute;
        top: 2px;
        right: 4px;
        color: #28a745;
        font-size: 10px;
        font-weight: bold;
    }
    .wcfd-wind-btn.calculated.active {
        background: #28a745;
        border-color: #28a745;
        color: white;
    }
    .wcfd-wind-btn.calculated.active::after { color: white; }
    .wcfd-wind-btn .dir { font-weight: 600; }
    .wcfd-wind-btn .speed { font-size: 10px; color: #666; }
    .wcfd-wind-btn.active .speed { color: rgba(255,255,255,0.8); }
    .wcfd-wind-btn.calculated .speed { color: #155724; }
    .wcfd-wind-btn.calculated.active .speed { color: rgba(255,255,255,0.8); }
    
    .wcfd-progress {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        background: #f0f7ff;
        border-radius: 6px;
        margin-top: 10px;
    }
    .wcfd-progress.hidden { display: none; }
    
    .wcfd-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid #ddd;
        border-top-color: #4a90e2;
        border-radius: 50%;
        animation: wcfd-spin 1s linear infinite;
    }
    @keyframes wcfd-spin { to { transform: rotate(360deg); } }
    
    .wcfd-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 10px;
    }
    .wcfd-legend-item {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
    }
    .wcfd-legend-color {
        width: 16px;
        height: 12px;
        border-radius: 2px;
        border: 1px solid rgba(0,0,0,0.1);
    }
    
    .wcfd-results-count {
        font-size: 12px;
        color: #666;
        margin-bottom: 8px;
    }
    
    .wcfd-slice-control {
        background: #f0f7ff;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 12px;
    }
    .wcfd-slice-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        font-size: 13px;
    }
    .wcfd-slice-value {
        font-weight: 600;
        color: #4a90e2;
        font-size: 14px;
    }
    #wcfd-slice-slider {
        width: 100%;
        margin-bottom: 10px;
        accent-color: #4a90e2;
    }
    
    .wcfd-height-label {
        position: absolute;
        background: rgba(74, 144, 226, 0.9);
        color: white;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        pointer-events: none;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    
    .wcfd-batch-progress { padding: 5px 0; }
    .wcfd-batch-status {
        font-weight: 600;
        margin-bottom: 10px;
        font-size: 14px;
    }
    .wcfd-batch-bar-container {
        background: #e0e0e0;
        border-radius: 10px;
        height: 20px;
        overflow: hidden;
        margin-bottom: 10px;
    }
    .wcfd-batch-bar {
        background: linear-gradient(90deg, #4CAF50, #8BC34A);
        height: 100%;
        transition: width 0.5s;
        border-radius: 10px;
    }
    .wcfd-batch-details {
        font-size: 12px;
        color: #666;
        margin-bottom: 10px;
        max-height: 150px;
        overflow-y: auto;
    }
    .wcfd-batch-item {
        padding: 4px 0;
        border-bottom: 1px solid #eee;
        display: flex;
        justify-content: space-between;
    }
    .wcfd-batch-item.done { color: #28a745; }
    .wcfd-batch-item.active { color: #4a90e2; font-weight: 600; }
    .wcfd-batch-item.pending { color: #999; }
    
    .wcfd-gradient-legend { margin-bottom: 10px; }
    .wcfd-gradient-bar {
        height: 16px;
        border-radius: 4px;
        background: linear-gradient(to right, 
            rgb(59, 76, 192),
            rgb(98, 130, 234),
            rgb(141, 176, 254),
            rgb(184, 208, 249),
            rgb(221, 221, 221),
            rgb(245, 196, 173),
            rgb(244, 154, 123),
            rgb(222, 96, 77),
            rgb(180, 4, 38)
        );
        border: 1px solid rgba(0,0,0,0.1);
    }
    .wcfd-gradient-labels {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: #666;
        margin-top: 4px;
    }
    
    .wcfd-mode-buttons {
        display: flex;
        gap: 4px;
        margin-bottom: 10px;
    }
    .wcfd-mode-btn {
        flex: 1;
        padding: 8px 4px;
        border: 2px solid #ddd;
        background: white;
        border-radius: 6px;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.2s;
    }
    .wcfd-mode-btn:hover { border-color: #4a90e2; }
    .wcfd-mode-btn.active {
        background: #4a90e2;
        border-color: #4a90e2;
        color: white;
    }
    .wcfd-vector-settings {
        background: #f8f9fa;
        border-radius: 6px;
        padding: 10px;
        margin-bottom: 10px;
    }
    .wcfd-vector-settings.wcfd-hidden { display: none; }
    #wcfd-density-slider, #wcfd-scale-slider {
        width: 100%;
        margin-bottom: 8px;
        accent-color: #4a90e2;
    }
`;

/**
 * CSS стили для модальных окон
 */
export const MODAL_STYLES = `
    #wcfd-command-modal, #wcfd-paraview-modal {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .wcfd-modal-backdrop {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5);
    }
    .wcfd-modal-content {
        position: relative;
        background: white;
        border-radius: 12px;
        width: 90%;
        max-width: 500px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    }
    .wcfd-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid #eee;
    }
    .wcfd-modal-header h3 { margin: 0; font-size: 18px; }
    .wcfd-modal-close {
        background: none;
        border: none;
        font-size: 28px;
        cursor: pointer;
        color: #999;
    }
    .wcfd-modal-body { padding: 20px; }
    .wcfd-modal-body p { margin: 0 0 12px 0; }
    .wcfd-command-box {
        background: #1e1e1e;
        border-radius: 8px;
        padding: 12px;
        margin: 12px 0;
        position: relative;
    }
    .wcfd-command-box code {
        display: block;
        color: #4ec9b0;
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 12px;
        word-break: break-all;
        padding-right: 80px;
    }
    .wcfd-copy-btn {
        position: absolute;
        top: 8px; right: 8px;
        background: #333;
        border: 1px solid #555;
        color: white;
        padding: 4px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
    }
    .wcfd-note { font-size: 13px; color: #666; font-style: italic; }
    .wcfd-modal-footer {
        padding: 16px 20px;
        border-top: 1px solid #eee;
        text-align: right;
    }
`;

/**
 * HTML шаблон главной панели
 */
export function createPanelHTML() {
    return `
        <div class="wcfd-header">
            <h3>🌀 CFD Ветровой анализ</h3>
            <button class="wcfd-close" id="wcfd-close">×</button>
        </div>
        
        <div class="wcfd-section">
            <div class="wcfd-label">1. Выбранные здания</div>
            <div class="wcfd-buildings-info" id="wcfd-buildings-info">Не выбрано</div>
            <button class="wcfd-btn" id="wcfd-select-buildings">Выбрать здания</button>
        </div>
        
        <div class="wcfd-section">
            <div class="wcfd-label">2. Расчётный домен</div>
            <div class="wcfd-domain-info" id="wcfd-domain-info">—</div>
            <label class="wcfd-checkbox">
                <input type="checkbox" id="wcfd-show-domain" checked>
                Показать домен
            </label>
        </div>
        
        <div class="wcfd-section">
            <div class="wcfd-label">3. Погодные данные (EPW)</div>
            <div class="wcfd-epw-info" id="wcfd-epw-info">Файл не загружен</div>
            <button class="wcfd-btn" id="wcfd-load-epw">Загрузить EPW</button>
        </div>
        
        <div class="wcfd-section wcfd-hidden" id="wcfd-direction-section">
            <div class="wcfd-label">4. Направление ветра</div>
            <div class="wcfd-wind-rose" id="wcfd-wind-rose"></div>
            <div class="wcfd-selected-wind" id="wcfd-selected-wind">—</div>
        </div>
        
        <!-- Настройки CFD (сворачиваемые) -->
        <div class="wcfd-section" id="wcfd-cfd-settings-section">
            <div class="wcfd-label wcfd-collapsible" id="wcfd-settings-toggle" style="cursor: pointer;">
                ⚙️ Настройки CFD <span style="float: right; font-size: 10px;">▼</span>
            </div>
            <div id="wcfd-settings-content" style="display: none; margin-top: 10px;">
                <div style="background: #e8f4e8; padding: 8px; border-radius: 4px; margin-bottom: 10px; font-size: 12px;">
                    <strong>Модель:</strong> k-ε (RANS)<br>
                    <strong>Стандарт:</strong> COST 732 / AIJ
                </div>
                
                <div class="wcfd-setting-group">
                    <label>Домен (×H) <span class="wcfd-help" title="H = высота самого высокого здания. Размеры домена влияют на точность и время расчёта.">?</span></label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 5px;">
                        <div>
                            <span style="font-size: 11px;" title="Расстояние от зданий до входной границы (откуда дует ветер). Рекомендуется 3-5H.">Inlet:</span>
                            <input type="number" id="wcfd-inlet-factor" value="5" min="2" max="10" step="0.5" style="width: 100%;">
                        </div>
                        <div>
                            <span style="font-size: 11px;" title="Расстояние до выходной границы (за зданиями). Важно для wake-зоны. Рекомендуется 6-15H.">Outlet:</span>
                            <input type="number" id="wcfd-outlet-factor" value="8" min="5" max="20" step="1" style="width: 100%;">
                        </div>
                        <div>
                            <span style="font-size: 11px;" title="Расстояние по бокам от зданий. Рекомендуется 2-5H.">Lateral:</span>
                            <input type="number" id="wcfd-lateral-factor" value="2.5" min="2" max="5" step="0.5" style="width: 100%;">
                        </div>
                        <div>
                            <span style="font-size: 11px;" title="Высота расчётного домена. Рекомендуется 5-6H для корректного ABL профиля.">Height:</span>
                            <input type="number" id="wcfd-height-factor" value="5" min="4" max="8" step="1" style="width: 100%;">
                        </div>
                    </div>
                </div>
                
                <div class="wcfd-setting-group" style="margin-top: 10px;">
                    <label>Сетка <span class="wcfd-help" title="Параметры расчётной сетки. Мельче сетка = точнее, но дольше.">?</span></label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 5px;">
                        <div>
                            <span style="font-size: 11px;" title="Размер базовой ячейки blockMesh. Меньше = больше ячеек, точнее результат.">Ячейка (м):</span>
                            <input type="number" id="wcfd-cell-size" value="5" min="2" max="10" step="1" style="width: 100%;">
                        </div>
                        <div>
                            <span style="font-size: 11px;" title="Максимальное количество ячеек (миллионы). Ограничивает память и время.">Макс. ячеек (M):</span>
                            <input type="number" id="wcfd-max-cells" value="3" min="1" max="10" step="1" style="width: 100%;">
                        </div>
                        <div>
                            <span style="font-size: 11px;" title="Минимальный уровень измельчения сетки у зданий. 0=без измельчения.">Refine min:</span>
                            <input type="number" id="wcfd-refine-min" value="1" min="0" max="3" step="1" style="width: 100%;">
                        </div>
                        <div>
                            <span style="font-size: 11px;" title="Максимальный уровень измельчения. Каждый уровень делит ячейку на 8.">Refine max:</span>
                            <input type="number" id="wcfd-refine-max" value="2" min="1" max="4" step="1" style="width: 100%;">
                        </div>
                    </div>
                </div>
                
                <div class="wcfd-setting-group" style="margin-top: 10px;">
                    <label>Расчёт <span class="wcfd-help" title="Параметры солвера simpleFoam.">?</span></label>
                    <div style="margin-top: 5px;">
                        <span style="font-size: 11px;" title="Количество итераций SIMPLE. Обычно сходится за 200-500. Больше = стабильнее.">Итерации:</span>
                        <input type="number" id="wcfd-iterations" value="400" min="100" max="1000" step="50" style="width: 100%;">
                    </div>
                </div>
                
                <button class="wcfd-btn" id="wcfd-apply-settings" style="margin-top: 10px; width: 100%;">
                    ✓ Применить настройки
                </button>
            </div>
        </div>
        
        <!-- Настройки визуализации векторов -->
        <div class="wcfd-section wcfd-hidden" id="wcfd-vector-settings-section">
            <div class="wcfd-label wcfd-collapsible" id="wcfd-vector-toggle" style="cursor: pointer;">
                🌊 Анимация потоков <span style="float: right; font-size: 10px;">▼</span>
            </div>
            <div id="wcfd-vector-content" style="display: none; margin-top: 10px;">
                <div class="wcfd-setting-group">
                    <label>Настройки анимации <span class="wcfd-help" title="Анимированные частицы, движущиеся по векторному полю скоростей.">?</span></label>
                    <div style="margin-top: 8px;">
                        <div style="display: flex; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 11px; width: 80px;" title="Количество частиц. Больше = плотнее поток, но тяжелее для GPU.">Частицы:</span>
                            <input type="range" id="wcfd-flow-particles" min="100" max="10000" step="100" value="800" style="flex: 1;">
                            <span id="wcfd-flow-particles-val" style="width: 50px; text-align: right; font-size: 11px;">800</span>
                        </div>
                        <div style="display: flex; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 11px; width: 80px;" title="Множитель скорости. 1x = реальная скорость ветра.">Скорость:</span>
                            <input type="range" id="wcfd-flow-speed" min="1" max="20" step="1" value="5" style="flex: 1;">
                            <span id="wcfd-flow-speed-val" style="width: 50px; text-align: right; font-size: 11px;">5x</span>
                        </div>
                        <div style="display: flex; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 11px; width: 80px;" title="Длина следа (хвоста) за каждой частицей.">Длина следа:</span>
                            <input type="range" id="wcfd-flow-trail" min="10" max="500" step="10" value="50" style="flex: 1;">
                            <span id="wcfd-flow-trail-val" style="width: 50px; text-align: right; font-size: 11px;">50</span>
                        </div>
                        <div style="display: flex; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 11px; width: 80px;" title="Время жизни частицы в секундах. Дольше = длиннее траектории.">Время жизни:</span>
                            <input type="range" id="wcfd-flow-lifetime" min="2" max="60" step="1" value="10" style="flex: 1;">
                            <span id="wcfd-flow-lifetime-val" style="width: 50px; text-align: right; font-size: 11px;">10 сек</span>
                        </div>
                        <div style="display: flex; align-items: center;">
                            <input type="checkbox" id="wcfd-flow-color-speed" checked style="margin-right: 8px;">
                            <span style="font-size: 11px;">Цвет по скорости</span>
                        </div>
                    </div>
                    <button class="wcfd-btn wcfd-btn-primary" id="wcfd-toggle-flow" style="margin-top: 10px; width: 100%;">
                        ▶️ Запустить анимацию
                    </button>
                </div>
            </div>
        </div>
        
        <div class="wcfd-section" id="wcfd-calc-section">
            <button class="wcfd-btn wcfd-btn-primary" id="wcfd-calculate" disabled>Запустить расчёт</button>
            <button class="wcfd-btn wcfd-btn-success" id="wcfd-calculate-all" disabled>🔄 Рассчитать все направления</button>
            <button class="wcfd-btn" id="wcfd-clear-server" style="margin-top: 10px; font-size: 12px;">🗑️ Очистить кеш сервера</button>
            <div class="wcfd-progress hidden" id="wcfd-progress">
                <div class="wcfd-spinner"></div>
                <span id="wcfd-progress-text">Расчёт...</span>
            </div>
        </div>
        
        <!-- Фиксированная секция прогресса расчёта -->
        <div class="wcfd-section wcfd-hidden" id="wcfd-calc-progress-section">
            <div class="wcfd-label">⏳ Расчёт в процессе</div>
            <div id="wcfd-calc-progress-info" style="font-size: 13px; margin-bottom: 8px;">—</div>
            <div style="background: #e0e0e0; border-radius: 10px; height: 16px; overflow: hidden;">
                <div id="wcfd-calc-progress-bar" style="background: linear-gradient(90deg, #4CAF50, #8BC34A); height: 100%; width: 0%; transition: width 0.5s;"></div>
            </div>
            <div id="wcfd-calc-progress-iter" style="margin-top: 6px; color: #666; font-size: 12px;">—</div>
            <button class="wcfd-btn wcfd-btn-danger" id="wcfd-calc-stop" style="margin-top: 8px;">⏹ Остановить</button>
        </div>
        
        <div class="wcfd-section wcfd-hidden" id="wcfd-results-section">
            <div class="wcfd-label">Результаты</div>
            <div class="wcfd-results-count" id="wcfd-results-count"></div>
            <div class="wcfd-slice-control" id="wcfd-slice-control">
                <div class="wcfd-slice-header">
                    <span>Высота сечения:</span>
                    <span class="wcfd-slice-value" id="wcfd-slice-value">1.75 м</span>
                </div>
                <input type="range" id="wcfd-slice-slider" min="0.5" max="50" step="0.25" value="1.75">
                <button class="wcfd-btn" id="wcfd-resample">🔄 Пересчитать срез</button>
            </div>
            <div class="wcfd-legend" id="wcfd-legend"></div>
            <button class="wcfd-btn" id="wcfd-hide-results">Скрыть результаты</button>
            <button class="wcfd-btn" id="wcfd-export-results">Экспорт JSON</button>
            <button class="wcfd-btn" id="wcfd-download-paraview">📦 Скачать для Paraview</button>
            <button class="wcfd-btn wcfd-btn-danger" id="wcfd-clear-all">Очистить все расчёты</button>
        </div>
    `;
}

/**
 * Добавление стилей в документ
 */
export function injectStyles() {
    if (document.getElementById('wind-cfd-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'wind-cfd-styles';
    style.textContent = PANEL_STYLES;
    document.head.appendChild(style);
}

/**
 * Добавление стилей модальных окон
 */
export function injectModalStyles() {
    if (document.getElementById('wcfd-modal-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'wcfd-modal-styles';
    style.textContent = MODAL_STYLES;
    document.head.appendChild(style);
}