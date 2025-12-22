/**
 * ============================================
 * UnderlayPanel.js
 * UI панель для управления подложками
 * ============================================
 */

class UnderlayPanel {
    /**
     * @param {UnderlayManager} underlayManager
     * @param {Object} options
     */
    constructor(underlayManager, options = {}) {
        this.underlayManager = underlayManager;
        this.groupManager = null; // Устанавливается через setGroupManager
        
        this.onChange = options.onChange || (() => {});
        this.onSelect = options.onSelect || (() => {});
        this.onLoad = options.onLoad || (() => {});
        this.onClose = options.onClose || null;
        this.onGroup = options.onGroup || (() => {});
        this.onUngroup = options.onUngroup || (() => {});
        
        this.panel = null;
        this.listEl = null;
        this.detailsEl = null;
        this.groupSection = null;
        
        // Состояние выбора зданий
        this.selectedBuildings = [];
        
        this._createPanel();
        
        console.log('[UnderlayPanel] Создан');
    }
    
    /**
     * Установить GroupManager
     */
    setGroupManager(groupManager) {
        this.groupManager = groupManager;
    }
    
    _createPanel() {
        // Панель
        this.panel = document.createElement('div');
        this.panel.id = 'underlay-panel';
        this.panel.className = 'underlay-panel hidden';
        this.panel.innerHTML = `
            <div class="panel-header">
                <span class="panel-title">DXF Подложки</span>
                <button class="panel-close" title="Закрыть">×</button>
            </div>
            <div class="panel-content">
                <div class="underlay-actions">
                    <button class="btn-load-dxf">+ Загрузить DXF</button>
                    <input type="file" class="file-input" accept=".dxf" style="display:none">
                </div>
                <div class="underlay-list"></div>
                <div class="underlay-details hidden">
                    <div class="detail-row">
                        <label>X:</label>
                        <input type="number" class="input-x" step="0.1"> м
                    </div>
                    <div class="detail-row">
                        <label>Y:</label>
                        <input type="number" class="input-y" step="0.1"> м
                    </div>
                    <div class="detail-row">
                        <label>Поворот:</label>
                        <input type="number" class="input-rotation" step="0.1"> °
                    </div>
                    <div class="detail-row">
                        <label>Высота:</label>
                        <button class="btn-elev-down">−</button>
                        <span class="elevation-value">0</span> м
                        <button class="btn-elev-up">+</button>
                    </div>
                    <div class="detail-actions">
                        <button class="btn-center">Центрировать</button>
                        <button class="btn-delete">Удалить</button>
                    </div>
                </div>
                
                <div class="group-section">
                    <div class="group-hint">
                        <small>Shift+клик — выбрать здания для группировки</small>
                    </div>
                    <div class="selected-buildings hidden">
                        <span class="selected-count">Выбрано зданий: 0</span>
                    </div>
                    <div class="group-actions hidden">
                        <button class="btn-group">Сгруппировать</button>
                        <button class="btn-clear-selection">Очистить выбор</button>
                    </div>
                    <div class="group-info hidden">
                        <span class="group-status">✓ Группа</span>
                        <button class="btn-ungroup">Разгруппировать</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.panel);
        
        this.listEl = this.panel.querySelector('.underlay-list');
        this.detailsEl = this.panel.querySelector('.underlay-details');
        this.groupSection = this.panel.querySelector('.group-section');
        
        this._bindEvents();
        this._injectStyles();
    }
    
    _bindEvents() {
        // Закрытие панели
        this.panel.querySelector('.panel-close').onclick = () => this.hide();
        
        // Загрузка файла
        const fileInput = this.panel.querySelector('.file-input');
        this.panel.querySelector('.btn-load-dxf').onclick = () => fileInput.click();
        
        fileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                const underlay = await this.underlayManager.loadFile(file);
                this._updateList();
                this._showDetails(underlay);
                this.onLoad(underlay);
            } catch (err) {
                alert(`Ошибка загрузки DXF: ${err.message}`);
            }
            
            fileInput.value = '';
        };
        
        // Поля ввода
        const inputX = this.panel.querySelector('.input-x');
        const inputY = this.panel.querySelector('.input-y');
        const inputRotation = this.panel.querySelector('.input-rotation');
        
        inputX.onchange = () => this._onPositionChange();
        inputY.onchange = () => this._onPositionChange();
        inputRotation.onchange = () => this._onRotationChange();
        
        // Высота
        this.panel.querySelector('.btn-elev-up').onclick = () => this._adjustElevation(1);
        this.panel.querySelector('.btn-elev-down').onclick = () => this._adjustElevation(-1);
        
        // Центрирование
        this.panel.querySelector('.btn-center').onclick = () => {
            this.underlayManager.centerSelectedOnScreen();
            this._updateDetails();
            this.onChange(this.underlayManager.getSelected());
        };
        
        // Удаление
        this.panel.querySelector('.btn-delete').onclick = () => {
            const underlay = this.underlayManager.getSelected();
            if (underlay && confirm(`Удалить "${underlay.name}"?`)) {
                // Удаляем группу если есть
                if (this.groupManager) {
                    const group = this.groupManager.getGroupByUnderlay(underlay.id);
                    if (group) {
                        this.groupManager.dissolveGroup(group.id);
                    }
                }
                this.underlayManager.remove(underlay.id);
                this._updateList();
                this.detailsEl.classList.add('hidden');
                this._updateGroupSection();
                this.onChange(null);
            }
        };
        
        // Группировка
        this.panel.querySelector('.btn-group').onclick = () => this._createGroup();
        this.panel.querySelector('.btn-ungroup').onclick = () => this._dissolveGroup();
        this.panel.querySelector('.btn-clear-selection').onclick = () => {
            // Очищаем выбор через SelectTool
            const selectTool = window.app?.state?.selectTool;
            if (selectTool) {
                selectTool.clearMultiSelection();
            }
            this.updateBuildingSelection([]);
        };
    }
    
    /**
     * Создать группу из выбранной подложки и зданий
     */
    _createGroup() {
        const underlay = this.underlayManager.getSelected();
        if (!underlay || !this.groupManager || this.selectedBuildings.length === 0) {
            return;
        }
        
        const group = this.groupManager.createGroup(underlay, this.selectedBuildings);
        
        // Очищаем выбор зданий через SelectTool
        const selectTool = window.app?.state?.selectTool;
        if (selectTool) {
            selectTool.clearMultiSelection();
        }
        this.selectedBuildings = [];
        
        this._updateGroupSection();
        this.onGroup(group);
        
        console.log(`[UnderlayPanel] Группа создана: ${group.id}`);
    }
    
    /**
     * Расформировать группу
     */
    _dissolveGroup() {
        const underlay = this.underlayManager.getSelected();
        if (!underlay || !this.groupManager) return;
        
        const group = this.groupManager.getGroupByUnderlay(underlay.id);
        if (!group) return;
        
        this.groupManager.dissolveGroup(group.id);
        this._updateGroupSection();
        this.onUngroup(group);
        
        console.log(`[UnderlayPanel] Группа расформирована`);
    }
    
    /**
     * Обновить секцию группировки
     */
    _updateGroupSection() {
        const underlay = this.underlayManager.getSelected();
        
        const selectedBuildingsEl = this.panel.querySelector('.selected-buildings');
        const groupActionsEl = this.panel.querySelector('.group-actions');
        const groupInfoEl = this.panel.querySelector('.group-info');
        const selectedCountEl = this.panel.querySelector('.selected-count');
        
        // Проверяем есть ли группа
        const hasGroup = underlay && this.groupManager && 
            this.groupManager.getGroupByUnderlay(underlay.id);
        
        if (hasGroup) {
            // Показываем инфо о группе
            selectedBuildingsEl.classList.add('hidden');
            groupActionsEl.classList.add('hidden');
            groupInfoEl.classList.remove('hidden');
            
            const group = this.groupManager.getGroupByUnderlay(underlay.id);
            this.panel.querySelector('.group-status').textContent = 
                `✓ Группа (${group.buildings.length} зданий)`;
        } else {
            // Показываем выбор зданий
            groupInfoEl.classList.add('hidden');
            
            if (this.selectedBuildings.length > 0) {
                selectedBuildingsEl.classList.remove('hidden');
                groupActionsEl.classList.remove('hidden');
                selectedCountEl.textContent = `Выбрано зданий: ${this.selectedBuildings.length}`;
            } else {
                selectedBuildingsEl.classList.add('hidden');
                groupActionsEl.classList.add('hidden');
            }
        }
    }
    
    /**
     * Обновить выбор зданий (вызывается из UnderlayTool)
     */
    updateBuildingSelection(buildings) {
        this.selectedBuildings = buildings;
        this._updateGroupSection();
    }
    
    _onPositionChange() {
        const underlay = this.underlayManager.getSelected();
        if (!underlay) return;
        
        const x = parseFloat(this.panel.querySelector('.input-x').value) || 0;
        const y = parseFloat(this.panel.querySelector('.input-y').value) || 0;
        
        underlay.setPosition(x, y);
        this.onChange(underlay);
    }
    
    _onRotationChange() {
        const underlay = this.underlayManager.getSelected();
        if (!underlay) return;
        
        const deg = parseFloat(this.panel.querySelector('.input-rotation').value) || 0;
        underlay.setRotation(deg * Math.PI / 180);
        this.onChange(underlay);
    }
    
    _adjustElevation(delta) {
        const underlay = this.underlayManager.getSelected();
        if (!underlay) return;
        
        underlay.adjustElevation(delta);
        this._updateDetails();
        this.onChange(underlay);
    }
    
    _updateList() {
        const underlays = this.underlayManager.getAll();
        const selectedId = this.underlayManager.selectedId;
        
        this.listEl.innerHTML = '';
        
        if (underlays.length === 0) {
            this.listEl.innerHTML = '<div class="empty-message">Нет подложек</div>';
            return;
        }
        
        for (const u of underlays) {
            const item = document.createElement('div');
            item.className = 'underlay-item' + (u.id === selectedId ? ' selected' : '');
            item.dataset.id = u.id;
            item.innerHTML = `
                <span class="item-radio">${u.id === selectedId ? '●' : '○'}</span>
                <span class="item-name">${u.name}</span>
                <button class="item-visibility" title="${u.visible ? 'Скрыть' : 'Показать'}">
                    ${u.visible ? '👁' : '👁‍🗨'}
                </button>
            `;
            
            // Выбор
            item.onclick = (e) => {
                if (e.target.classList.contains('item-visibility')) return;
                this.underlayManager.select(u.id);
                this._updateList();
                this._showDetails(u);
                this.onSelect(u);
            };
            
            // Видимость
            item.querySelector('.item-visibility').onclick = () => {
                u.setVisible(!u.visible);
                this._updateList();
            };
            
            this.listEl.appendChild(item);
        }
    }
    
    _showDetails(underlay) {
        if (!underlay) {
            this.detailsEl.classList.add('hidden');
            this._updateGroupSection();
            return;
        }
        
        this.detailsEl.classList.remove('hidden');
        this._updateDetails();
        this._updateGroupSection();
    }
    
    _updateDetails() {
        const underlay = this.underlayManager.getSelected();
        if (!underlay) return;
        
        this.panel.querySelector('.input-x').value = underlay.position.x.toFixed(1);
        this.panel.querySelector('.input-y').value = underlay.position.y.toFixed(1);
        this.panel.querySelector('.input-rotation').value = 
            (underlay.rotation * 180 / Math.PI).toFixed(1);
        this.panel.querySelector('.elevation-value').textContent = 
            underlay.elevation.toFixed(0);
    }
    
    /**
     * Показать панель
     */
    show() {
        this.panel.classList.remove('hidden');
        this._updateList();
        
        const underlay = this.underlayManager.getSelected();
        if (underlay) {
            this._showDetails(underlay);
        }
    }
    
    /**
     * Скрыть панель
     */
    hide() {
        this.panel.classList.add('hidden');
        if (this.onClose) {
            this.onClose();
        }
    }
    
    /**
     * Переключить видимость
     */
    toggle() {
        if (this.panel.classList.contains('hidden')) {
            this.show();
        } else {
            this.hide();
        }
    }
    
    /**
     * Обновить панель (при внешних изменениях)
     */
    refresh() {
        this._updateList();
        this._updateDetails();
    }
    
    /**
     * Выбрать подложку (при выборе через инструмент)
     */
    selectUnderlay(underlay) {
        this._updateList();
        this._showDetails(underlay);
    }
    
    _injectStyles() {
        if (document.getElementById('underlay-panel-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'underlay-panel-styles';
        style.textContent = `
            .underlay-panel {
                position: fixed;
                right: 20px;
                top: 80px;
                width: 280px;
                background: rgba(30, 30, 35, 0.95);
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                z-index: 1000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: #fff;
            }
            
            .underlay-panel.hidden {
                display: none;
            }
            
            .underlay-panel .panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            
            .underlay-panel .panel-title {
                font-weight: 600;
                font-size: 14px;
            }
            
            .underlay-panel .panel-close {
                background: none;
                border: none;
                color: #888;
                font-size: 20px;
                cursor: pointer;
                padding: 0;
                line-height: 1;
            }
            
            .underlay-panel .panel-close:hover {
                color: #fff;
            }
            
            .underlay-panel .panel-content {
                padding: 12px;
            }
            
            .underlay-panel .underlay-actions {
                margin-bottom: 12px;
            }
            
            .underlay-panel .btn-load-dxf {
                width: 100%;
                padding: 10px;
                background: #2196f3;
                border: none;
                border-radius: 6px;
                color: #fff;
                font-size: 14px;
                cursor: pointer;
                transition: background 0.2s;
            }
            
            .underlay-panel .btn-load-dxf:hover {
                background: #1976d2;
            }
            
            .underlay-panel .underlay-list {
                max-height: 200px;
                overflow-y: auto;
                margin-bottom: 12px;
            }
            
            .underlay-panel .empty-message {
                text-align: center;
                color: #666;
                padding: 20px;
                font-size: 13px;
            }
            
            .underlay-panel .underlay-item {
                display: flex;
                align-items: center;
                padding: 8px 10px;
                border-radius: 6px;
                cursor: pointer;
                margin-bottom: 4px;
                transition: background 0.2s;
            }
            
            .underlay-panel .underlay-item:hover {
                background: rgba(255,255,255,0.1);
            }
            
            .underlay-panel .underlay-item.selected {
                background: rgba(33, 150, 243, 0.3);
            }
            
            .underlay-panel .item-radio {
                margin-right: 8px;
                color: #2196f3;
            }
            
            .underlay-panel .item-name {
                flex: 1;
                font-size: 13px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .underlay-panel .item-visibility {
                background: none;
                border: none;
                cursor: pointer;
                font-size: 14px;
                padding: 2px 6px;
                opacity: 0.7;
            }
            
            .underlay-panel .item-visibility:hover {
                opacity: 1;
            }
            
            .underlay-panel .underlay-details {
                border-top: 1px solid rgba(255,255,255,0.1);
                padding-top: 12px;
            }
            
            .underlay-panel .underlay-details.hidden {
                display: none;
            }
            
            .underlay-panel .detail-row {
                display: flex;
                align-items: center;
                margin-bottom: 8px;
                font-size: 13px;
            }
            
            .underlay-panel .detail-row label {
                width: 60px;
                color: #888;
            }
            
            .underlay-panel .detail-row input {
                width: 80px;
                padding: 4px 8px;
                background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 4px;
                color: #fff;
                font-size: 13px;
                margin-right: 4px;
            }
            
            .underlay-panel .detail-row button {
                width: 28px;
                height: 28px;
                background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 4px;
                color: #fff;
                cursor: pointer;
                font-size: 16px;
                margin-right: 4px;
            }
            
            .underlay-panel .detail-row button:hover {
                background: rgba(255,255,255,0.2);
            }
            
            .underlay-panel .elevation-value {
                display: inline-block;
                width: 30px;
                text-align: center;
            }
            
            .underlay-panel .detail-actions {
                display: flex;
                gap: 8px;
                margin-top: 12px;
            }
            
            .underlay-panel .detail-actions button {
                flex: 1;
                padding: 8px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                transition: background 0.2s;
            }
            
            .underlay-panel .btn-center {
                background: rgba(255,255,255,0.1);
                color: #fff;
            }
            
            .underlay-panel .btn-center:hover {
                background: rgba(255,255,255,0.2);
            }
            
            .underlay-panel .btn-delete {
                background: rgba(244, 67, 54, 0.2);
                color: #f44336;
            }
            
            .underlay-panel .btn-delete:hover {
                background: rgba(244, 67, 54, 0.4);
            }
            
            /* Group section */
            .underlay-panel .group-section {
                border-top: 1px solid rgba(255,255,255,0.1);
                margin-top: 12px;
                padding-top: 12px;
            }
            
            .underlay-panel .group-hint {
                color: #888;
                margin-bottom: 8px;
            }
            
            .underlay-panel .group-hint small {
                font-size: 11px;
            }
            
            .underlay-panel .selected-buildings {
                background: rgba(155, 89, 182, 0.2);
                padding: 8px 12px;
                border-radius: 6px;
                margin-bottom: 8px;
            }
            
            .underlay-panel .selected-buildings.hidden {
                display: none;
            }
            
            .underlay-panel .selected-count {
                color: #9b59b6;
                font-weight: 500;
            }
            
            .underlay-panel .group-actions {
                display: flex;
                gap: 8px;
            }
            
            .underlay-panel .group-actions.hidden {
                display: none;
            }
            
            .underlay-panel .group-actions button {
                flex: 1;
                padding: 8px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                transition: background 0.2s;
            }
            
            .underlay-panel .btn-group {
                background: #9b59b6;
                color: #fff;
            }
            
            .underlay-panel .btn-group:hover {
                background: #8e44ad;
            }
            
            .underlay-panel .btn-clear-selection {
                background: rgba(255,255,255,0.1);
                color: #fff;
            }
            
            .underlay-panel .btn-clear-selection:hover {
                background: rgba(255,255,255,0.2);
            }
            
            .underlay-panel .group-info {
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: rgba(46, 204, 113, 0.2);
                padding: 8px 12px;
                border-radius: 6px;
            }
            
            .underlay-panel .group-info.hidden {
                display: none;
            }
            
            .underlay-panel .group-status {
                color: #2ecc71;
                font-weight: 500;
            }
            
            .underlay-panel .btn-ungroup {
                background: rgba(255,255,255,0.1);
                border: none;
                color: #fff;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
            }
            
            .underlay-panel .btn-ungroup:hover {
                background: rgba(255,255,255,0.2);
            }
        `;
        
        document.head.appendChild(style);
    }
}

export { UnderlayPanel };
