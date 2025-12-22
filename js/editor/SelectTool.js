/**
 * ============================================
 * SelectTool.js
 * Выбор зданий и подложек кликом
 * Shift+клик — добавить/убрать из множественного выбора
 * Работает со зданиями и подложками одинаково
 * ============================================
 */

class SelectTool {
    constructor(sceneManager, options = {}) {
        this.sceneManager = sceneManager;
        this.camera = sceneManager.camera;
        this.renderer = sceneManager.renderer;
        this.buildingsGroup = sceneManager.getBuildingsGroup();
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Состояние — одиночный выбор (для совместимости)
        this.selectedMesh = null;
        this.selectedUnderlay = null;
        this.hoveredMesh = null;
        this.hoveredUnderlay = null;
        this.enabled = true;
        
        // Множественный выбор — хранит объекты { type: 'building'|'underlay', item: mesh|underlay }
        this.selectedItems = new Map(); // key: id, value: { type, item }
        
        // Цвета
        this.selectedColor = 0xff6b6b;      // Красный — одиночный выбор
        this.multiSelectColor = 0x9b59b6;   // Фиолетовый — множественный выбор
        this.hoverColor = 0xffaa00;         // Оранжевый — hover
        
        // Callbacks
        this.onSelect = options.onSelect || (() => {});
        this.onMultiSelect = options.onMultiSelect || (() => {});
        this.onHover = options.onHover || (() => {});
        
        this._boundOnClick = this._onClick.bind(this);
        this._boundOnMouseMove = this._onMouseMove.bind(this);
        
        this._init();
        
        console.log('[SelectTool] Создан');
    }
    
    _init() {
        this.renderer.domElement.addEventListener('click', this._boundOnClick);
        this.renderer.domElement.addEventListener('mousemove', this._boundOnMouseMove);
    }
    
    _getMousePosition(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }
    
    /**
     * Raycast для зданий
     */
    _raycastBuilding() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const buildings = this.buildingsGroup.children.filter(child => {
            if (child.visible && child.userData.type === 'building') return true;
            if (child.visible && child.userData.subtype === 'solar-potential') return true;
            return false;
        });
        
        if (buildings.length === 0) return null;
        
        const intersects = this.raycaster.intersectObjects(buildings, false);
        return intersects.length > 0 ? intersects[0].object : null;
    }
    
    /**
     * Raycast для подложек
     */
    _raycastUnderlay() {
        const manager = window.app?.state?.underlayManager;
        if (!manager) return null;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        return manager.raycast(this.raycaster);
    }
    
    /**
     * Raycast — возвращает ближайший объект (здание или подложку)
     */
    _raycastAny() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        let result = null;
        let minDistance = Infinity;
        
        // Проверяем здания
        const buildings = this.buildingsGroup.children.filter(child => {
            if (child.visible && child.userData.type === 'building') return true;
            if (child.visible && child.userData.subtype === 'solar-potential') return true;
            return false;
        });
        
        const buildingIntersects = this.raycaster.intersectObjects(buildings, false);
        if (buildingIntersects.length > 0 && buildingIntersects[0].distance < minDistance) {
            minDistance = buildingIntersects[0].distance;
            result = { type: 'building', item: buildingIntersects[0].object, distance: minDistance };
        }
        
        // Проверяем подложки
        const manager = window.app?.state?.underlayManager;
        if (manager) {
            const underlay = manager.raycast(this.raycaster);
            if (underlay) {
                // Подложки на земле, так что distance примерно равен расстоянию до камеры
                // Для простоты считаем что подложка "ближе" если здание не найдено
                // или если клик попал на подложку (hitbox)
                const underlayDistance = this._getUnderlayDistance(underlay);
                if (underlayDistance < minDistance) {
                    result = { type: 'underlay', item: underlay, distance: underlayDistance };
                }
            }
        }
        
        return result;
    }
    
    _getUnderlayDistance(underlay) {
        // Примерное расстояние до подложки
        if (underlay.mesh) {
            const pos = underlay.mesh.position;
            return this.camera.position.distanceTo(pos);
        }
        return Infinity;
    }
    
    _onClick(event) {
        if (!this.enabled) return;
        if (event.button !== 0) return;
        
        this._getMousePosition(event);
        
        const isShift = event.shiftKey;
        const hit = this._raycastAny();
        
        if (isShift) {
            // Множественный выбор
            this._handleMultiSelect(hit);
        } else {
            // Одиночный выбор
            this._handleSingleSelect(hit);
        }
    }
    
    /**
     * Одиночный выбор
     */
    _handleSingleSelect(hit) {
        // Очищаем множественный выбор
        this._clearMultiSelection();
        
        // Снимаем предыдущее выделение
        this._deselectCurrent();
        
        if (!hit) {
            this.onSelect(null, null);
            return;
        }
        
        if (hit.type === 'building') {
            const mesh = hit.item;
            this._saveOriginalColor(mesh);
            this.selectedMesh = mesh;
            mesh.material.color.setHex(this.selectedColor);
            
            console.log('[SelectTool] Выбрано здание:', mesh.userData.id);
            this.onSelect(mesh.userData, mesh);
            
        } else if (hit.type === 'underlay') {
            const underlay = hit.item;
            this.selectedUnderlay = underlay;
            underlay.setSelected(true, false);
            
            // Выбираем в менеджере
            const manager = window.app?.state?.underlayManager;
            if (manager) {
                manager.select(underlay.id);
            }
            
            // Показываем панель
            if (window.showUnderlayPanel) {
                window.showUnderlayPanel();
            }
            
            console.log('[SelectTool] Выбрана подложка:', underlay.name);
            this.onSelect({ type: 'underlay', underlay }, null);
        }
    }
    
    /**
     * Множественный выбор (Shift+клик)
     */
    _handleMultiSelect(hit) {
        if (!hit) return;
        
        // Снимаем одиночный выбор и переносим в мультивыбор
        if (this.selectedMesh) {
            const id = this.selectedMesh.userData.id;
            if (!this.selectedItems.has(id)) {
                this.selectedItems.set(id, { type: 'building', item: this.selectedMesh });
                this.selectedMesh.material.color.setHex(this.multiSelectColor);
            }
            this.selectedMesh = null;
        }
        
        if (this.selectedUnderlay) {
            const id = this.selectedUnderlay.id;
            if (!this.selectedItems.has(id)) {
                this.selectedItems.set(id, { type: 'underlay', item: this.selectedUnderlay });
                this.selectedUnderlay.setSelected(true, true);
            }
            this.selectedUnderlay = null;
        }
        
        const id = hit.type === 'building' ? hit.item.userData.id : hit.item.id;
        
        if (this.selectedItems.has(id)) {
            // Убираем из выбора
            const entry = this.selectedItems.get(id);
            this._restoreItem(entry);
            this.selectedItems.delete(id);
            console.log('[SelectTool] Убрано из выбора:', id);
        } else {
            // Добавляем в выбор
            if (hit.type === 'building') {
                this._saveOriginalColor(hit.item);
                hit.item.material.color.setHex(this.multiSelectColor);
            } else {
                hit.item.setSelected(true, true);
            }
            this.selectedItems.set(id, { type: hit.type, item: hit.item });
            console.log('[SelectTool] Добавлено в выбор:', id);
        }
        
        // Callbacks
        this._notifyMultiSelect();
    }
    
    /**
     * Восстановить цвет объекта
     */
    _restoreItem(entry) {
        if (entry.type === 'building') {
            this._restoreColor(entry.item);
        } else if (entry.type === 'underlay') {
            entry.item.setSelected(false);
        }
    }
    
    /**
     * Снять текущее выделение
     */
    _deselectCurrent() {
        if (this.selectedMesh) {
            this._restoreColor(this.selectedMesh);
            this.selectedMesh = null;
        }
        
        if (this.selectedUnderlay) {
            this.selectedUnderlay.setSelected(false);
            this.selectedUnderlay = null;
        }
    }
    
    /**
     * Очистить множественный выбор
     */
    _clearMultiSelection() {
        for (const entry of this.selectedItems.values()) {
            this._restoreItem(entry);
        }
        this.selectedItems.clear();
        
        // Уведомляем панель
        const underlayPanel = window.app?.controllers?.underlay?.panel;
        if (underlayPanel) {
            underlayPanel.updateBuildingSelection([]);
        }
    }
    
    /**
     * Уведомить о множественном выборе
     */
    _notifyMultiSelect() {
        const buildings = [];
        const underlays = [];
        
        for (const entry of this.selectedItems.values()) {
            if (entry.type === 'building') {
                buildings.push(entry.item);
            } else {
                underlays.push(entry.item);
            }
        }
        
        this.onMultiSelect({ buildings, underlays });
        
        // Обновляем панель подложек
        const underlayPanel = window.app?.controllers?.underlay?.panel;
        if (underlayPanel) {
            underlayPanel.updateBuildingSelection(buildings);
        }
        
        // Показываем карточку первого здания если есть
        if (buildings.length > 0) {
            this.onSelect(buildings[0].userData, buildings[0]);
        } else if (underlays.length > 0) {
            this.onSelect({ type: 'underlay', underlay: underlays[0] }, null);
        }
    }
    
    _onMouseMove(event) {
        if (!this.enabled) return;
        
        this._getMousePosition(event);
        
        // Hover для зданий
        const mesh = this._raycastBuilding();
        
        if (mesh !== this.hoveredMesh) {
            // Снимаем hover с предыдущего
            if (this.hoveredMesh && this.hoveredMesh !== this.selectedMesh && 
                !this.selectedItems.has(this.hoveredMesh.userData.id)) {
                this._restoreColor(this.hoveredMesh);
            }
            
            this.hoveredMesh = mesh;
            
            // Применяем hover к новому
            if (mesh && mesh !== this.selectedMesh && 
                !this.selectedItems.has(mesh.userData.id)) {
                this._saveOriginalColor(mesh);
                mesh.material.color.setHex(this.hoverColor);
            }
            
            this.onHover(mesh);
        }
        
        // Hover для подложек
        const underlay = this._raycastUnderlay();
        
        if (underlay !== this.hoveredUnderlay) {
            if (this.hoveredUnderlay && this.hoveredUnderlay !== this.selectedUnderlay &&
                !this.selectedItems.has(this.hoveredUnderlay.id)) {
                this.hoveredUnderlay.setHovered(false);
            }
            
            this.hoveredUnderlay = underlay;
            
            if (underlay && underlay !== this.selectedUnderlay &&
                !this.selectedItems.has(underlay.id)) {
                underlay.setHovered(true);
            }
        }
        
        // Курсор
        this.renderer.domElement.style.cursor = (mesh || underlay) ? 'pointer' : 'default';
    }
    
    _saveOriginalColor(mesh) {
        if (mesh && mesh.userData.originalColor === undefined) {
            mesh.userData.originalColor = mesh.material.color.getHex();
        }
    }
    
    _restoreColor(mesh) {
        if (mesh && mesh.userData.originalColor !== undefined) {
            mesh.material.color.setHex(mesh.userData.originalColor);
        }
    }
    
    // =============================================
    // Публичные методы
    // =============================================
    
    /**
     * Получить выбранные здания
     */
    getSelectedBuildings() {
        const buildings = [];
        for (const entry of this.selectedItems.values()) {
            if (entry.type === 'building') {
                buildings.push(entry.item);
            }
        }
        // Добавляем одиночный выбор если есть
        if (this.selectedMesh && !this.selectedItems.has(this.selectedMesh.userData.id)) {
            buildings.push(this.selectedMesh);
        }
        return buildings;
    }
    
    /**
     * Получить выбранные подложки
     */
    getSelectedUnderlays() {
        const underlays = [];
        for (const entry of this.selectedItems.values()) {
            if (entry.type === 'underlay') {
                underlays.push(entry.item);
            }
        }
        if (this.selectedUnderlay && !this.selectedItems.has(this.selectedUnderlay.id)) {
            underlays.push(this.selectedUnderlay);
        }
        return underlays;
    }
    
    /**
     * Очистить множественный выбор (публичный метод)
     */
    clearMultiSelection() {
        this._clearMultiSelection();
    }
    
    /**
     * Снять весь выбор
     */
    deselect() {
        this._deselectCurrent();
        this._clearMultiSelection();
        this.onSelect(null, null);
    }
    
    /**
     * Включить/выключить инструмент (совместимость с App.js)
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }
    
    enable() {
        this.enabled = true;
    }
    
    disable() {
        this.enabled = false;
    }
    
    /**
     * Программный выбор mesh (совместимость с App.js)
     */
    select(mesh) {
        if (mesh) {
            this._handleSingleSelect({ type: 'building', item: mesh });
        }
    }
    
    /**
     * Получить текущий выбранный mesh (совместимость с App.js)
     */
    getSelected() {
        return this.selectedMesh;
    }
    
    /**
     * Получить все выбранные здания (для совместимости с InsolationController)
     */
    getSelectedMultiple() {
        return this.getSelectedBuildings();
    }
    
    /**
     * Программный выбор по ID
     */
    selectById(id) {
        // Ищем здание
        const mesh = this.buildingsGroup.children.find(c => c.userData?.id === id);
        if (mesh) {
            this._handleSingleSelect({ type: 'building', item: mesh });
            return;
        }
        
        // Ищем подложку
        const manager = window.app?.state?.underlayManager;
        if (manager) {
            const underlay = manager.get(id);
            if (underlay) {
                this._handleSingleSelect({ type: 'underlay', item: underlay });
            }
        }
    }
    
    /**
     * Обновить группу зданий (после перезагрузки)
     */
    updateBuildingsGroup() {
        this.buildingsGroup = this.sceneManager.getBuildingsGroup();
        this.deselect();
    }
    
    /**
     * Уничтожить
     */
    dispose() {
        this.renderer.domElement.removeEventListener('click', this._boundOnClick);
        this.renderer.domElement.removeEventListener('mousemove', this._boundOnMouseMove);
        this.deselect();
    }
}

export { SelectTool };
window.SelectTool = SelectTool;
