/**
 * ============================================
 * SelectTool.js
 * Выбор зданий, деревьев и подложек кликом
 * Shift+клик — добавить/убрать из множественного выбора
 * 
 * Поддержка CFD:
 * - Отдельный список cfdSelectedTrees для расчёта ветра
 * - Оранжевая подсветка деревьев для CFD
 * - Интеграция с WindCFD модулем
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
        
        // Состояние — одиночный выбор
        this.selectedMesh = null;
        this.selectedUnderlay = null;
        this.selectedTree = null;
        this.hoveredMesh = null;
        this.hoveredUnderlay = null;
        this.hoveredTree = null;
        this.enabled = true;
        
        // Множественный выбор
        this.selectedItems = new Map();
        
        // ========== CFD: Отдельный выбор деревьев для расчёта ==========
        this.cfdSelectedTrees = new Map(); // id -> tree
        this.cfdMode = false; // Режим выбора деревьев для CFD
        
        // Цвета
        this.selectedColor = 0xff6b6b;
        this.multiSelectColor = 0x9b59b6;
        this.hoverColor = 0xffaa00;
        this.cfdTreeColor = 0xff8800;      // Оранжевый для CFD деревьев
        this.cfdTreeEmissive = 0x442200;   // Свечение CFD деревьев
        
        // Callbacks
        this.onSelect = options.onSelect || (() => {});
        this.onMultiSelect = options.onMultiSelect || (() => {});
        this.onHover = options.onHover || (() => {});
        this.onCFDTreesChange = options.onCFDTreesChange || (() => {}); // Callback для CFD
        
        this._boundOnClick = this._onClick.bind(this);
        this._boundOnMouseMove = this._onMouseMove.bind(this);
        
        this._init();
        
        console.log('[SelectTool] Создан с поддержкой CFD');
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
        
        // Добавляем измерения
        const measureGroup = this.sceneManager.getMeasurementsGroup?.();
        if (measureGroup) {
            const measurements = measureGroup.children.filter(child => 
                child.visible && child.userData.type === 'measurement'
            );
            buildings.push(...measurements);
        }
        
        if (buildings.length === 0) return null;
        
        const intersects = this.raycaster.intersectObjects(buildings, false);
        return intersects.length > 0 ? intersects[0].object : null;
    }
    
    /**
     * Raycast для деревьев
     */
    _raycastTree() {
        const treesGroup = this.sceneManager.scene.getObjectByName('trees');
        if (!treesGroup || treesGroup.children.length === 0) return null;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Деревья - это Group, нужен recursive raycast
        const intersects = this.raycaster.intersectObjects(treesGroup.children, true);
        
        if (intersects.length > 0) {
            // Найти родительскую группу дерева
            let obj = intersects[0].object;
            while (obj.parent && obj.userData.type !== 'tree') {
                obj = obj.parent;
            }
            if (obj.userData.type === 'tree') {
                return { tree: obj, distance: intersects[0].distance };
            }
        }
        
        return null;
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
     * Raycast — возвращает ближайший объект
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
        
        // Добавляем измерения
        const measureGroup = this.sceneManager.getMeasurementsGroup?.();
        if (measureGroup) {
            const measurements = measureGroup.children.filter(child => 
                child.visible && child.userData.type === 'measurement'
            );
            buildings.push(...measurements);
        }
        
        const buildingIntersects = this.raycaster.intersectObjects(buildings, false);
        if (buildingIntersects.length > 0 && buildingIntersects[0].distance < minDistance) {
            minDistance = buildingIntersects[0].distance;
            result = { type: 'building', item: buildingIntersects[0].object, distance: minDistance };
        }
        
        // Проверяем деревья
        const treeResult = this._raycastTree();
        if (treeResult && treeResult.distance < minDistance) {
            minDistance = treeResult.distance;
            result = { type: 'tree', item: treeResult.tree, distance: minDistance };
        }
        
        // Проверяем подложки
        const manager = window.app?.state?.underlayManager;
        if (manager) {
            const underlay = manager.raycast(this.raycaster);
            if (underlay) {
                const underlayDistance = this._getUnderlayDistance(underlay);
                if (underlayDistance < minDistance) {
                    result = { type: 'underlay', item: underlay, distance: underlayDistance };
                }
            }
        }
        
        return result;
    }
    
    _getUnderlayDistance(underlay) {
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
        
        // CFD режим: клик на дерево добавляет/убирает его из CFD списка
        if (this.cfdMode && hit && hit.type === 'tree') {
            this._handleCFDTreeClick(hit.item, isShift);
            return;
        }
        
        if (isShift) {
            this._handleMultiSelect(hit);
        } else {
            this._handleSingleSelect(hit);
        }
    }
    
    // ========== CFD: Обработка клика на дерево ==========
    
    _handleCFDTreeClick(tree, addToSelection) {
        const id = tree.userData.id || tree.uuid;
        
        if (this.cfdSelectedTrees.has(id)) {
            // Убираем из CFD
            this._unhighlightCFDTree(tree);
            this.cfdSelectedTrees.delete(id);
            console.log(`[SelectTool] CFD: убрано дерево ${id}, осталось: ${this.cfdSelectedTrees.size}`);
        } else {
            // Добавляем в CFD
            this._highlightCFDTree(tree);
            this.cfdSelectedTrees.set(id, tree);
            console.log(`[SelectTool] CFD: добавлено дерево ${id}, всего: ${this.cfdSelectedTrees.size}`);
        }
        
        // Уведомляем WindCFD
        this.onCFDTreesChange(this.getCFDSelectedTrees());
        
        // Обновляем UI если есть WindCFD
        if (window.windCFD) {
            window.windCFD.updateBuildingsInfo?.();
        }
    }
    
    _highlightCFDTree(tree) {
        tree.traverse(child => {
            if (child.isMesh && child.material) {
                // Сохраняем оригинальные цвета
                if (child.material.color && !child.userData._cfdOriginalColor) {
                    child.userData._cfdOriginalColor = child.material.color.getHex();
                }
                if (child.material.emissive && !child.userData._cfdOriginalEmissive) {
                    child.userData._cfdOriginalEmissive = child.material.emissive.getHex();
                }
                
                // Подсвечиваем оранжевым
                if (child.material.color) {
                    child.material.color.setHex(this.cfdTreeColor);
                }
                if (child.material.emissive) {
                    child.material.emissive.setHex(this.cfdTreeEmissive);
                }
            }
        });
    }
    
    _unhighlightCFDTree(tree) {
        tree.traverse(child => {
            if (child.isMesh && child.material) {
                // Восстанавливаем оригинальные цвета
                if (child.userData._cfdOriginalColor !== undefined && child.material.color) {
                    child.material.color.setHex(child.userData._cfdOriginalColor);
                }
                if (child.userData._cfdOriginalEmissive !== undefined && child.material.emissive) {
                    child.material.emissive.setHex(child.userData._cfdOriginalEmissive);
                }
            }
        });
    }
    
    /**
     * Одиночный выбор
     */
    _handleSingleSelect(hit) {
        this._clearMultiSelection();
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
            
        } else if (hit.type === 'tree') {
            const tree = hit.item;
            this.selectedTree = tree;
            
            // Подсветка через TreeTool
            if (window.app?.state?.treeTool) {
                window.app.state.treeTool.showEditPanel(tree);
            }
            
            console.log('[SelectTool] Выбрано дерево:', tree.userData.id);
            this.onSelect(tree.userData, tree);
            
        } else if (hit.type === 'underlay') {
            const underlay = hit.item;
            this.selectedUnderlay = underlay;
            underlay.setSelected(true, false);
            
            const manager = window.app?.state?.underlayManager;
            if (manager) {
                manager.select(underlay.id);
            }
            
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
        
        if (this.selectedTree) {
            const id = this.selectedTree.userData.id;
            if (!this.selectedItems.has(id)) {
                this.selectedItems.set(id, { type: 'tree', item: this.selectedTree });
                // Подсвечиваем в мультиселекте
                this._highlightTreeMulti(this.selectedTree);
            }
            // Снимаем подсветку TreeTool
            if (window.app?.state?.treeTool) {
                window.app.state.treeTool.hidePanel();
            }
            this.selectedTree = null;
        }
        
        if (this.selectedUnderlay) {
            const id = this.selectedUnderlay.id;
            if (!this.selectedItems.has(id)) {
                this.selectedItems.set(id, { type: 'underlay', item: this.selectedUnderlay });
                this.selectedUnderlay.setSelected(true, true);
            }
            this.selectedUnderlay = null;
        }
        
        const id = hit.item.userData?.id || hit.item.id;
        
        if (this.selectedItems.has(id)) {
            const entry = this.selectedItems.get(id);
            this._restoreItem(entry);
            this.selectedItems.delete(id);
            console.log('[SelectTool] Убрано из выбора:', id);
        } else {
            if (hit.type === 'building') {
                this._saveOriginalColor(hit.item);
                hit.item.material.color.setHex(this.multiSelectColor);
            } else if (hit.type === 'underlay') {
                hit.item.setSelected(true, true);
            } else if (hit.type === 'tree') {
                // Подсвечиваем дерево в мультиселекте
                this._highlightTreeMulti(hit.item);
            }
            this.selectedItems.set(id, { type: hit.type, item: hit.item });
            console.log('[SelectTool] Добавлено в выбор:', id);
        }
        
        this._notifyMultiSelect();
    }
    
    /**
     * Подсветка дерева в мультиселекте (фиолетовый)
     */
    _highlightTreeMulti(tree) {
        tree.traverse(child => {
            if (child.isMesh && child.material && child.material.color) {
                if (!child.userData._multiOriginalColor) {
                    child.userData._multiOriginalColor = child.material.color.getHex();
                }
                child.material.color.setHex(this.multiSelectColor);
            }
        });
    }
    
    /**
     * Снять подсветку дерева мультиселекта
     */
    _unhighlightTreeMulti(tree) {
        tree.traverse(child => {
            if (child.isMesh && child.material && child.material.color) {
                if (child.userData._multiOriginalColor !== undefined) {
                    child.material.color.setHex(child.userData._multiOriginalColor);
                    delete child.userData._multiOriginalColor;
                }
            }
        });
    }
    
    /**
     * Восстановить цвет объекта
     */
    _restoreItem(entry) {
        if (entry.type === 'building') {
            this._restoreColor(entry.item);
        } else if (entry.type === 'underlay') {
            entry.item.setSelected(false);
        } else if (entry.type === 'tree') {
            this._unhighlightTreeMulti(entry.item);
            // Снимаем подсветку TreeTool
            if (window.app?.state?.treeTool?.treeMesh) {
                window.app.state.treeTool.treeMesh.unhighlight?.(entry.item);
            }
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
        
        if (this.selectedTree) {
            if (window.app?.state?.treeTool) {
                window.app.state.treeTool.hidePanel();
            }
            this.selectedTree = null;
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
        const trees = [];
        
        for (const entry of this.selectedItems.values()) {
            if (entry.type === 'building') {
                buildings.push(entry.item);
            } else if (entry.type === 'underlay') {
                underlays.push(entry.item);
            } else if (entry.type === 'tree') {
                trees.push(entry.item);
            }
        }
        
        this.onMultiSelect({ buildings, underlays, trees });
        
        const underlayPanel = window.app?.controllers?.underlay?.panel;
        if (underlayPanel) {
            underlayPanel.updateBuildingSelection(buildings);
        }
        
        if (buildings.length > 0) {
            this.onSelect(buildings[0].userData, buildings[0]);
        } else if (trees.length > 0) {
            this.onSelect(trees[0].userData, trees[0]);
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
            if (this.hoveredMesh && this.hoveredMesh !== this.selectedMesh && 
                !this.selectedItems.has(this.hoveredMesh.userData.id)) {
                this._restoreColor(this.hoveredMesh);
            }
            
            this.hoveredMesh = mesh;
            
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
        
        // Hover для деревьев
        const treeResult = this._raycastTree();
        const tree = treeResult?.tree || null;
        
        if (tree !== this.hoveredTree) {
            this.hoveredTree = tree;
        }
        
        // Курсор
        this.renderer.domElement.style.cursor = (mesh || underlay || tree) ? 'pointer' : 'default';
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
    
    getSelectedBuildings() {
        const buildings = [];
        for (const entry of this.selectedItems.values()) {
            if (entry.type === 'building') {
                buildings.push(entry.item);
            }
        }
        if (this.selectedMesh && !this.selectedItems.has(this.selectedMesh.userData.id)) {
            buildings.push(this.selectedMesh);
        }
        return buildings;
    }
    
    getSelectedTrees() {
        const trees = [];
        for (const entry of this.selectedItems.values()) {
            if (entry.type === 'tree') {
                trees.push(entry.item);
            }
        }
        if (this.selectedTree && !this.selectedItems.has(this.selectedTree.userData.id)) {
            trees.push(this.selectedTree);
        }
        return trees;
    }
    
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
    
    // ========== CFD методы ==========
    
    /**
     * Включить/выключить режим CFD выбора деревьев
     */
    setCFDMode(enabled) {
        this.cfdMode = enabled;
        console.log(`[SelectTool] CFD mode: ${enabled ? 'ON' : 'OFF'}`);
        
        if (!enabled) {
            // При выключении можно сохранить или очистить выбор
            // this.clearCFDTreeSelection();
        }
    }
    
    /**
     * Получить деревья, выбранные для CFD
     */
    getCFDSelectedTrees() {
        return Array.from(this.cfdSelectedTrees.values());
    }
    
    /**
     * Добавить дерево в CFD выбор программно
     */
    addTreeToCFD(tree) {
        const id = tree.userData.id || tree.uuid;
        if (!this.cfdSelectedTrees.has(id)) {
            this._highlightCFDTree(tree);
            this.cfdSelectedTrees.set(id, tree);
            this.onCFDTreesChange(this.getCFDSelectedTrees());
        }
    }
    
    /**
     * Убрать дерево из CFD выбора
     */
    removeTreeFromCFD(tree) {
        const id = tree.userData.id || tree.uuid;
        if (this.cfdSelectedTrees.has(id)) {
            this._unhighlightCFDTree(tree);
            this.cfdSelectedTrees.delete(id);
            this.onCFDTreesChange(this.getCFDSelectedTrees());
        }
    }
    
    /**
     * Очистить CFD выбор деревьев
     */
    clearCFDTreeSelection() {
        for (const tree of this.cfdSelectedTrees.values()) {
            this._unhighlightCFDTree(tree);
        }
        this.cfdSelectedTrees.clear();
        this.onCFDTreesChange([]);
        console.log('[SelectTool] CFD tree selection cleared');
    }
    
    /**
     * Проверить, выбрано ли дерево для CFD
     */
    isTreeSelectedForCFD(tree) {
        const id = tree.userData.id || tree.uuid;
        return this.cfdSelectedTrees.has(id);
    }
    
    // ========== Остальные публичные методы ==========
    
    clearMultiSelection() {
        this._clearMultiSelection();
    }
    
    deselect() {
        this._deselectCurrent();
        this._clearMultiSelection();
        this.onSelect(null, null);
    }
    
    setEnabled(enabled) {
        this.enabled = enabled;
    }
    
    enable() {
        this.enabled = true;
    }
    
    disable() {
        this.enabled = false;
    }
    
    select(mesh) {
        if (mesh) {
            const type = mesh.userData?.type === 'tree' ? 'tree' : 'building';
            this._handleSingleSelect({ type, item: mesh });
        }
    }
    
    getSelected() {
        return this.selectedMesh || this.selectedTree;
    }
    
    getSelectedMultiple() {
        return this.getSelectedBuildings();
    }
    
    selectById(id) {
        // Ищем здание
        const mesh = this.buildingsGroup.children.find(c => c.userData?.id === id);
        if (mesh) {
            this._handleSingleSelect({ type: 'building', item: mesh });
            return;
        }
        
        // Ищем дерево
        const treesGroup = this.sceneManager.scene.getObjectByName('trees');
        if (treesGroup) {
            const tree = treesGroup.children.find(c => c.userData?.id === id);
            if (tree) {
                this._handleSingleSelect({ type: 'tree', item: tree });
                return;
            }
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
    
    updateBuildingsGroup() {
        this.buildingsGroup = this.sceneManager.getBuildingsGroup();
        this.deselect();
    }
    
    dispose() {
        this.renderer.domElement.removeEventListener('click', this._boundOnClick);
        this.renderer.domElement.removeEventListener('mousemove', this._boundOnMouseMove);
        this.deselect();
        this.clearCFDTreeSelection();
    }
}

export { SelectTool };
window.SelectTool = SelectTool;