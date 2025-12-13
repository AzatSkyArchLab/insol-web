/**
 * ============================================
 * SelectTool.js
 * Выбор зданий кликом (одиночный и множественный)
 * Shift+клик — добавить/убрать из множественного выбора
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
        this.hoveredMesh = null;
        this.enabled = true;
        
        // Множественный выбор
        this.selectedMeshes = new Set();
        
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
    
    _raycast() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const buildings = this.buildingsGroup.children.filter(child => {
            return child.visible && child.userData.type === 'building';
        });
        
        if (buildings.length === 0) {
            return null;
        }
        
        const intersects = this.raycaster.intersectObjects(buildings, false);
        
        if (intersects.length > 0) {
            return intersects[0].object;
        }
        
        return null;
    }
    
    _onClick(event) {
        if (!this.enabled) return;
        if (event.button !== 0) return;
        
        this._getMousePosition(event);
        const mesh = this._raycast();
        
        const isShiftPressed = event.shiftKey;
        
        console.log('[SelectTool] Клик, Shift:', isShiftPressed, ', найдено:', mesh ? mesh.userData.id : 'ничего');
        
        if (isShiftPressed) {
            // Множественный выбор
            this._handleMultiSelect(mesh);
        } else {
            // Одиночный выбор
            this._handleSingleSelect(mesh);
        }
    }
    
    _handleSingleSelect(mesh) {
        // Очищаем множественный выбор
        this._clearMultiSelection();
        
        // Снимаем выделение с предыдущего
        if (this.selectedMesh && this.selectedMesh !== mesh) {
            this._restoreColor(this.selectedMesh);
        }
        
        if (mesh) {
            this._saveOriginalColor(mesh);
            this.selectedMesh = mesh;
            mesh.material.color.setHex(this.selectedColor);
            
            console.log('[SelectTool] Выбрано:', mesh.userData.id);
            this.onSelect(mesh.userData, mesh);
        } else {
            this.selectedMesh = null;
            this.onSelect(null, null);
        }
    }
    
    _handleMultiSelect(mesh) {
        if (!mesh) return;
        
        // Если есть одиночный выбор — переносим его в множественный
        if (this.selectedMesh && !this.selectedMeshes.has(this.selectedMesh)) {
            this._saveOriginalColor(this.selectedMesh);
            this.selectedMeshes.add(this.selectedMesh);
            this.selectedMesh.material.color.setHex(this.multiSelectColor);
            console.log('[SelectTool] Перенесено в множественный выбор:', this.selectedMesh.userData.id);
        }
        this.selectedMesh = null;
        
        this._saveOriginalColor(mesh);
        
        if (this.selectedMeshes.has(mesh)) {
            // Убираем из выбора
            this.selectedMeshes.delete(mesh);
            this._restoreColor(mesh);
            console.log('[SelectTool] Убрано из множественного выбора:', mesh.userData.id);
        } else {
            // Добавляем в выбор
            this.selectedMeshes.add(mesh);
            mesh.material.color.setHex(this.multiSelectColor);
            console.log('[SelectTool] Добавлено в множественный выбор:', mesh.userData.id);
        }
        
        // Callback с массивом выбранных
        const selectedArray = Array.from(this.selectedMeshes);
        this.onMultiSelect(selectedArray);
        
        // Вызываем onSelect для отображения карточки (если есть выбранные)
        if (selectedArray.length > 0) {
            // Показываем инфо о первом здании (или можно показать сводку)
            this.onSelect(selectedArray[0].userData, selectedArray[0]);
        } else {
            this.onSelect(null, null);
        }
    }
    
    _clearMultiSelection() {
        for (const mesh of this.selectedMeshes) {
            this._restoreColor(mesh);
        }
        this.selectedMeshes.clear();
    }
    
    _saveOriginalColor(mesh) {
        if (mesh && mesh.userData.originalColor === undefined) {
            mesh.userData.originalColor = mesh.material.color.getHex();
        }
    }
    
    _onMouseMove(event) {
        if (!this.enabled) return;
        
        this._getMousePosition(event);
        const mesh = this._raycast();
        
        // Убираем hover с предыдущего
        if (this.hoveredMesh && this.hoveredMesh !== mesh) {
            if (this.hoveredMesh !== this.selectedMesh && !this.selectedMeshes.has(this.hoveredMesh)) {
                this._restoreColor(this.hoveredMesh);
            }
        }
        
        // Устанавливаем hover на новый
        if (mesh && mesh !== this.selectedMesh && !this.selectedMeshes.has(mesh)) {
            this._saveOriginalColor(mesh);
            this.hoveredMesh = mesh;
            mesh.material.color.setHex(this.hoverColor);
            this.renderer.domElement.style.cursor = 'pointer';
            this.onHover(mesh.userData, mesh);
        } else if (!mesh) {
            this.hoveredMesh = null;
            this.renderer.domElement.style.cursor = 'default';
            this.onHover(null, null);
        } else {
            this.renderer.domElement.style.cursor = 'pointer';
        }
    }
    
    _restoreColor(mesh) {
        if (!mesh || !mesh.material) return;
        
        const originalColor = mesh.userData.originalColor;
        if (originalColor !== undefined) {
            mesh.material.color.setHex(originalColor);
        }
    }
    
    /**
     * Снять выделение (одиночное и множественное)
     */
    deselect() {
        if (this.selectedMesh) {
            this._restoreColor(this.selectedMesh);
            this.selectedMesh = null;
        }
        if (this.hoveredMesh) {
            this._restoreColor(this.hoveredMesh);
            this.hoveredMesh = null;
        }
        this._clearMultiSelection();
    }
    
    /**
     * Получить выбранное здание (одиночный выбор или первое из множественного)
     */
    getSelected() {
        return this.selectedMesh;
    }
    
    /**
     * Получить все выбранные здания (множественный выбор)
     */
    getSelectedMultiple() {
        // Если есть множественный выбор — возвращаем его
        if (this.selectedMeshes.size > 0) {
            return Array.from(this.selectedMeshes);
        }
        // Иначе возвращаем одиночный выбор как массив
        if (this.selectedMesh) {
            return [this.selectedMesh];
        }
        return [];
    }
    
    /**
     * Проверить есть ли множественный выбор
     */
    hasMultipleSelection() {
        return this.selectedMeshes.size > 1;
    }
    
    /**
     * Количество выбранных
     */
    getSelectionCount() {
        if (this.selectedMeshes.size > 0) {
            return this.selectedMeshes.size;
        }
        return this.selectedMesh ? 1 : 0;
    }
    
    /**
     * Включить/выключить
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            // НЕ сбрасываем выделение при отключении
            // чтобы сохранить выбор для других инструментов
            this.renderer.domElement.style.cursor = 'default';
        }
    }
    
    /**
     * Выбрать конкретный mesh программно
     */
    select(mesh) {
        this._clearMultiSelection();
        
        if (this.selectedMesh) {
            this._restoreColor(this.selectedMesh);
        }
        
        if (mesh) {
            this._saveOriginalColor(mesh);
            this.selectedMesh = mesh;
            mesh.material.color.setHex(this.selectedColor);
            this.onSelect(mesh.userData, mesh);
        }
    }
    
    /**
     * Добавить в множественный выбор программно
     */
    addToSelection(mesh) {
        if (!mesh) return;
        
        this._saveOriginalColor(mesh);
        this.selectedMeshes.add(mesh);
        mesh.material.color.setHex(this.multiSelectColor);
        
        if (!this.selectedMesh) {
            this.selectedMesh = mesh;
        }
        
        this.onMultiSelect(Array.from(this.selectedMeshes));
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