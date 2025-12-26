/**
 * ============================================
 * DetailedGridController.js
 * Контроллер редактирования инсоляционной сетки
 * ============================================
 */

import { GridEditMode } from '../insolation/GridEditMode.js';

class DetailedGridController {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.bus = app.bus;
        
        // Режим редактирования
        this.editMode = null;
        this.isEditing = false;
        
        this._bindEvents();
        this._bindBusEvents();
        this._createStyles();
        
        console.log('[DetailedGridController] Создан');
    }
    
    _bindEvents() {
        // Кнопка редактирования сетки
        const editBtn = document.getElementById('edit-grid-btn');
        if (editBtn) {
            editBtn.addEventListener('click', () => this.onEditGridClick());
        }
        
        // Кнопка сброса
        const resetBtn = document.getElementById('reset-grid-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.onResetGridClick());
        }
        
        // Кнопка применить
        const applyBtn = document.getElementById('apply-grid-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => this.onApplyClick());
        }
        
        // Кнопка отменить
        const cancelBtn = document.getElementById('cancel-grid-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.onCancelClick());
        }
    }
    
    _bindBusEvents() {
        // При загрузке сцены
        this.bus.on('scene:loaded', () => {
            this._initEditMode();
        });
        
        // При выборе здания
        this.bus.on('building:selected', ({ mesh }) => {
            this._updateButtonsState(mesh);
        });
        
        this.bus.on('building:deselected', () => {
            this._stopEditing();
            this._updateButtonsState(null);
        });
        
        // При создании/очистке сетки
        this.bus.on('insolation:calculated', () => {
            const mesh = this.state.selectTool?.getSelected();
            this._updateButtonsState(mesh);
        });
        
        this.bus.on('insolation:cleared', () => {
            this._stopEditing();
            this._updateButtonsState(null);
        });
        
        // При изменении высоты здания
        this.bus.on('building:changed', ({ mesh, changeType }) => {
            if (changeType !== 'height' && changeType !== 'height-complete') return;
            
            const customGrid = mesh?.userData?.customGrid;
            if (!customGrid) return;
            
            const newHeight = mesh.userData.properties?.height || 9;
            const floorHeight = 3.0;  // Строго 3 метра на этаж
            
            console.log('[DetailedGridController] Обновляю customGrid, новая высота:', newHeight);
            
            // Создаём горизонтальные линии со строгим шагом 3м
            // Верхний этаж может быть меньше 3м
            const newHorizontalLines = [0];
            for (let z = floorHeight; z < newHeight; z += floorHeight) {
                newHorizontalLines.push(z);
            }
            newHorizontalLines.push(newHeight);  // Верхняя граница
            
            // Обновляем все фасады
            for (const facade of customGrid.facades) {
                if (!facade) continue;
                facade.horizontalLines = [...newHorizontalLines];
            }
            
            // Пересоздаём инсоляционную сетку
            if (this.state.insolationGrid?.isMeshActive(mesh)) {
                this.state.insolationGrid.createGridWithCustomLayout(mesh);
            }
            
            // Если режим редактирования активен, пересоздаём edges
            if (this.isEditing && this.editMode) {
                this.editMode._rebuild();
            }
        });
    }
    
    _initEditMode() {
        if (!this.state.insolationGrid) return;
        
        this.editMode = new GridEditMode(this.state.insolationGrid);
        
        this.editMode.onGridChanged = (mesh) => {
            this.bus.emit('grid:changed', { mesh });
        };
        
        console.log('[DetailedGridController] EditMode инициализирован');
    }
    
    onEditGridClick() {
        if (!this.isEditing) {
            this._startEditing();
        }
    }
    
    onApplyClick() {
        if (!this.isEditing || !this.editMode) return;
        
        this.editMode.applyChanges();
        this.isEditing = false;
        
        // Включаем SelectTool обратно
        if (this.state.selectTool) {
            this.state.selectTool.setEnabled(true);
            console.log('[DetailedGridController] SelectTool включён');
        }
        
        const mesh = this.state.selectTool?.getSelected();
        this._updateButtonsState(mesh);
        this.bus.emit('grid:editFinished', { mesh, applied: true });
    }
    
    onCancelClick() {
        if (!this.isEditing || !this.editMode) return;
        
        this.editMode.cancelChanges();
        this.isEditing = false;
        
        // Включаем SelectTool обратно
        if (this.state.selectTool) {
            this.state.selectTool.setEnabled(true);
            console.log('[DetailedGridController] SelectTool включён');
        }
        
        const mesh = this.state.selectTool?.getSelected();
        this._updateButtonsState(mesh);
        this.bus.emit('grid:editFinished', { mesh, applied: false });
    }
    
    onResetGridClick() {
        if (!this.editMode || !this.isEditing) return;
        this.editMode.resetToUniform();
    }
    
    _startEditing() {
        const mesh = this.state.selectTool?.getSelected();
        if (!mesh) {
            alert('Сначала выберите здание');
            return;
        }
        
        if (!this.state.insolationGrid?.hasGrid()) {
            alert('Сначала создайте инсоляционную сетку');
            return;
        }
        
        if (!this.state.insolationGrid.isMeshActive(mesh)) {
            alert('Инсоляционная сетка создана для другого здания');
            return;
        }
        
        if (!this.editMode) {
            this._initEditMode();
        }
        
        // ВАЖНО: Отключаем SelectTool чтобы он не перехватывал клики
        if (this.state.selectTool) {
            this.state.selectTool.setEnabled(false);
            console.log('[DetailedGridController] SelectTool отключён');
        }
        
        this.editMode.enable(mesh);
        this.isEditing = true;
        
        this._updateButtonsState(mesh);
        this.bus.emit('grid:editStarted', { mesh });
    }
    
    _stopEditing() {
        if (!this.isEditing) return;
        
        // Отменяем изменения при принудительной остановке
        if (this.editMode) {
            this.editMode.cancelChanges();
        }
        
        this.isEditing = false;
        
        // Включаем SelectTool обратно
        if (this.state.selectTool) {
            this.state.selectTool.setEnabled(true);
            console.log('[DetailedGridController] SelectTool включён');
        }
        
        const mesh = this.state.selectTool?.getSelected();
        this._updateButtonsState(mesh);
        this.bus.emit('grid:editFinished', { mesh, applied: false });
    }
    
    _updateButtonsState(mesh) {
        const editBtn = document.getElementById('edit-grid-btn');
        const resetBtn = document.getElementById('reset-grid-btn');
        const applyBtn = document.getElementById('apply-grid-btn');
        const cancelBtn = document.getElementById('cancel-grid-btn');
        
        if (!editBtn) return;
        
        const hasGrid = this.state.insolationGrid?.hasGrid() && 
                        this.state.insolationGrid?.isMeshActive(mesh);
        
        if (!mesh || !hasGrid) {
            editBtn.disabled = true;
            editBtn.textContent = 'Редактировать сетку';
            editBtn.style.display = '';
            if (resetBtn) resetBtn.style.display = 'none';
            if (applyBtn) applyBtn.style.display = 'none';
            if (cancelBtn) cancelBtn.style.display = 'none';
            return;
        }
        
        if (this.isEditing) {
            // В режиме редактирования: скрываем Edit, показываем Apply/Cancel/Reset
            editBtn.style.display = 'none';
            if (applyBtn) applyBtn.style.display = '';
            if (cancelBtn) cancelBtn.style.display = '';
            if (resetBtn) resetBtn.style.display = '';
        } else {
            // Не в режиме редактирования: показываем Edit
            editBtn.disabled = false;
            editBtn.textContent = 'Редактировать сетку';
            editBtn.style.display = '';
            editBtn.classList.remove('active');
            if (applyBtn) applyBtn.style.display = 'none';
            if (cancelBtn) cancelBtn.style.display = 'none';
            if (resetBtn) resetBtn.style.display = 'none';
        }
    }
    
    _createStyles() {
        if (document.getElementById('grid-edit-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'grid-edit-styles';
        style.textContent = `
            #edit-grid-btn {
                background: #f8f9fa;
                color: #1a73e8;
                border: 1px solid #1a73e8;
            }
            #edit-grid-btn:hover:not(:disabled) {
                background: #e8f0fe;
            }
            #edit-grid-btn.active {
                background: #1a73e8;
                color: white;
            }
            #edit-grid-btn:disabled {
                background: #f1f3f4;
                color: #9aa0a6;
                border-color: #dadce0;
            }
            #apply-grid-btn {
                background: #34a853;
                color: white;
                border: 1px solid #2d9248;
                font-size: 12px;
                padding: 6px 12px;
            }
            #apply-grid-btn:hover {
                background: #2d9248;
            }
            #cancel-grid-btn {
                background: #f8f9fa;
                color: #5f6368;
                border: 1px solid #dadce0;
                font-size: 12px;
                padding: 6px 12px;
            }
            #cancel-grid-btn:hover {
                background: #e8eaed;
            }
            #reset-grid-btn {
                background: #fff3e0;
                color: #e65100;
                border: 1px solid #ffb74d;
                font-size: 12px;
                padding: 6px 12px;
            }
            #reset-grid-btn:hover {
                background: #ffe0b2;
            }
            .grid-edit-buttons {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }
        `;
        document.head.appendChild(style);
    }
}

export { DetailedGridController };