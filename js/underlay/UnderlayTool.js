/**
 * ============================================
 * UnderlayTool.js
 * Инструмент для работы с подложками
 * (перемещение, поворот, выбор, группировка)
 * ============================================
 */

class UnderlayTool {
    /**
     * @param {SceneManager} sceneManager
     * @param {UnderlayManager} underlayManager
     * @param {Object} options
     */
    constructor(sceneManager, underlayManager, options = {}) {
        this.sceneManager = sceneManager;
        this.underlayManager = underlayManager;
        this.scene = sceneManager.scene;
        this.camera = sceneManager.camera;
        this.renderer = sceneManager.renderer;
        this.controls = sceneManager.controls;
        
        // GroupManager устанавливается позже через setGroupManager
        this.groupManager = null;
        
        this.enabled = false;
        this.isMoving = false;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        
        // Для перемещения
        this.startPos = { x: 0, y: 0 };
        this.moveOffset = { x: 0, y: 0 };
        this.startRotation = 0;
        this.startBuildingPositions = []; // Для отката зданий группы
        
        // Мультивыбор зданий (для группировки)
        this.selectedBuildings = new Set();
        this.buildingHighlightColor = 0x9b59b6; // Фиолетовый
        
        // Поворот
        this.rotationStep = Math.PI / 36;      // 5°
        this.rotationStepFine = Math.PI / 180; // 1° (с Shift)
        
        // Callbacks
        this.onChange = options.onChange || (() => {});
        this.onSelect = options.onSelect || (() => {});
        this.onBuildingSelect = options.onBuildingSelect || (() => {});
        
        // Bindings
        this._boundOnClick = this._onClick.bind(this);
        this._boundOnMouseMove = this._onMouseMove.bind(this);
        this._boundOnRightClick = this._onRightClick.bind(this);
        this._boundOnKeyDown = this._onKeyDown.bind(this);
        this._boundOnWheel = this._onWheel.bind(this);
        
        console.log('[UnderlayTool] Создан');
    }
    
    /**
     * Установить GroupManager
     */
    setGroupManager(groupManager) {
        this.groupManager = groupManager;
    }
    
    enable() {
        if (this.enabled) return;
        this.enabled = true;
        
        const canvas = this.renderer.domElement;
        
        // capture: true — получаем события раньше SelectTool
        canvas.addEventListener('click', this._boundOnClick, true);
        canvas.addEventListener('mousemove', this._boundOnMouseMove);
        canvas.addEventListener('contextmenu', this._boundOnRightClick);
        canvas.addEventListener('wheel', this._boundOnWheel, { passive: false });
        document.addEventListener('keydown', this._boundOnKeyDown);
        
        canvas.style.cursor = 'crosshair';
        
        console.log('[UnderlayTool] Включен');
    }
    
    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        
        const canvas = this.renderer.domElement;
        
        canvas.removeEventListener('click', this._boundOnClick, true);
        canvas.removeEventListener('mousemove', this._boundOnMouseMove);
        canvas.removeEventListener('contextmenu', this._boundOnRightClick);
        canvas.removeEventListener('wheel', this._boundOnWheel);
        document.removeEventListener('keydown', this._boundOnKeyDown);
        
        canvas.style.cursor = 'default';
        
        this._cancelMove();
        this.clearBuildingSelection();
        this.controls.enabled = true;
        
        console.log('[UnderlayTool] Выключен');
    }
    
    _getMousePosition(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }
    
    _getGroundPoint() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const point = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(this.groundPlane, point);
        return point;
    }
    
    /**
     * Raycast для зданий
     */
    _raycastBuilding() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const buildingsGroup = this.sceneManager.getBuildingsGroup();
        const buildings = buildingsGroup.children.filter(c => 
            c.visible && c.userData?.type === 'building'
        );
        
        const intersects = this.raycaster.intersectObjects(buildings, false);
        return intersects.length > 0 ? intersects[0].object : null;
    }
    
    _onClick(event) {
        if (!this.enabled) return;
        
        this._getMousePosition(event);
        const isShift = event.shiftKey;
        
        if (this.isMoving) {
            // Завершаем перемещение
            this._finishMove();
            event.stopPropagation();
            return;
        }
        
        // Пробуем выбрать подложку
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const underlay = this.underlayManager.raycast(this.raycaster);
        
        if (underlay) {
            if (!isShift) {
                // Обычный клик — выбираем подложку и начинаем перемещение
                this.underlayManager.select(underlay.id);
                this.onSelect(underlay);
                this._startMove(underlay);
            }
            event.stopPropagation();
            return;
        }
        
        // Shift+клик на здание — добавляем/убираем из выбора
        if (isShift) {
            const building = this._raycastBuilding();
            if (building) {
                this._toggleBuildingSelection(building);
                event.stopPropagation();
                return;
            }
        }
        
        // Клик в пустоту — снимаем выбор зданий
        if (!isShift) {
            this.clearBuildingSelection();
        }
    }
    
    /**
     * Переключить выбор здания
     */
    _toggleBuildingSelection(building) {
        const id = building.userData.id;
        
        if (this.selectedBuildings.has(id)) {
            // Убираем из выбора
            this.selectedBuildings.delete(id);
            this._unhighlightBuilding(building);
        } else {
            // Добавляем в выбор
            this.selectedBuildings.add(id);
            this._highlightBuilding(building);
        }
        
        this.onBuildingSelect(this.getSelectedBuildings());
    }
    
    /**
     * Подсветить здание
     */
    _highlightBuilding(building) {
        if (!building._originalColor) {
            building._originalColor = building.material.color.getHex();
        }
        building.material.color.setHex(this.buildingHighlightColor);
    }
    
    /**
     * Снять подсветку
     */
    _unhighlightBuilding(building) {
        if (building._originalColor !== undefined) {
            building.material.color.setHex(building._originalColor);
            delete building._originalColor;
        }
    }
    
    /**
     * Очистить выбор зданий
     */
    clearBuildingSelection() {
        const buildingsGroup = this.sceneManager.getBuildingsGroup();
        
        for (const id of this.selectedBuildings) {
            const building = buildingsGroup.children.find(c => c.userData?.id === id);
            if (building) {
                this._unhighlightBuilding(building);
            }
        }
        
        this.selectedBuildings.clear();
        this.onBuildingSelect([]);
    }
    
    /**
     * Получить выбранные здания
     */
    getSelectedBuildings() {
        const buildingsGroup = this.sceneManager.getBuildingsGroup();
        const buildings = [];
        
        for (const id of this.selectedBuildings) {
            const building = buildingsGroup.children.find(c => c.userData?.id === id);
            if (building) {
                buildings.push(building);
            }
        }
        
        return buildings;
    }
    
    _startMove(underlay) {
        this.isMoving = true;
        
        this.startPos.x = underlay.position.x;
        this.startPos.y = underlay.position.y;
        this.startRotation = underlay.rotation;
        
        // Сохраняем позиции зданий группы для отката
        this.startBuildingPositions = [];
        if (this.groupManager) {
            const group = this.groupManager.getGroupByUnderlay(underlay.id);
            if (group) {
                for (const building of group.buildings) {
                    this.startBuildingPositions.push({
                        building,
                        x: building.position.x,
                        y: building.position.y,
                        z: building.position.z
                    });
                }
            }
        }
        
        // Offset от курсора до позиции подложки
        const groundPoint = this._getGroundPoint();
        this.moveOffset.x = underlay.position.x - groundPoint.x;
        this.moveOffset.y = underlay.position.y - groundPoint.y;
        
        // Обновляем плоскость на высоту подложки
        this.groundPlane.constant = -underlay.elevation;
        
        this.controls.enabled = false;
        this.renderer.domElement.style.cursor = 'grabbing';
        
        console.log(`[UnderlayTool] Начато перемещение: ${underlay.name}`);
    }
    
    _finishMove() {
        const underlay = this.underlayManager.getSelected();
        if (!underlay) return;
        
        this.isMoving = false;
        this.controls.enabled = true;
        this.renderer.domElement.style.cursor = 'crosshair';
        
        // Сбрасываем плоскость
        this.groundPlane.constant = 0;
        this.startBuildingPositions = [];
        
        this.onChange(underlay);
        
        console.log(`[UnderlayTool] Завершено перемещение: ${underlay.name}`);
    }
    
    _cancelMove() {
        const underlay = this.underlayManager.getSelected();
        if (!underlay || !this.isMoving) return;
        
        // Возвращаем подложку на исходную позицию
        underlay.setPosition(this.startPos.x, this.startPos.y);
        underlay.setRotation(this.startRotation);
        
        // Возвращаем здания группы
        for (const saved of this.startBuildingPositions) {
            saved.building.position.set(saved.x, saved.y, saved.z);
        }
        
        this.isMoving = false;
        this.controls.enabled = true;
        this.renderer.domElement.style.cursor = 'crosshair';
        this.groundPlane.constant = 0;
        this.startBuildingPositions = [];
        
        console.log(`[UnderlayTool] Отменено перемещение: ${underlay.name}`);
    }
    
    _onMouseMove(event) {
        if (!this.enabled) return;
        
        this._getMousePosition(event);
        
        if (this.isMoving) {
            const underlay = this.underlayManager.getSelected();
            if (!underlay) return;
            
            const groundPoint = this._getGroundPoint();
            underlay.setPosition(
                groundPoint.x + this.moveOffset.x,
                groundPoint.y + this.moveOffset.y
            );
            
            // Обновляем позиции зданий группы
            if (this.groupManager) {
                const group = this.groupManager.getGroupByUnderlay(underlay.id);
                if (group) {
                    this.groupManager.updateBuildingsPosition(group);
                }
            }
        } else {
            // Hover эффект
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const underlay = this.underlayManager.raycast(this.raycaster);
            this.renderer.domElement.style.cursor = underlay ? 'pointer' : 'crosshair';
        }
    }
    
    _onRightClick(event) {
        if (!this.enabled) return;
        
        event.preventDefault();
        
        if (this.isMoving) {
            this._cancelMove();
        }
    }
    
    _onKeyDown(event) {
        if (!this.enabled) return;
        
        const underlay = this.underlayManager.getSelected();
        if (!underlay) return;
        
        // Escape — отмена
        if (event.key === 'Escape') {
            if (this.isMoving) {
                this._cancelMove();
            }
            return;
        }
        
        // Delete — удаление
        if (event.key === 'Delete') {
            if (confirm(`Удалить подложку "${underlay.name}"?`)) {
                // Удаляем группу если есть
                if (this.groupManager) {
                    const group = this.groupManager.getGroupByUnderlay(underlay.id);
                    if (group) {
                        this.groupManager.dissolveGroup(group.id);
                    }
                }
                this.underlayManager.remove(underlay.id);
                this.onChange(null);
            }
            return;
        }
        
        // Поворот: R/E или [/]
        if (this.isMoving) {
            const step = event.shiftKey ? this.rotationStepFine : this.rotationStep;
            
            if (event.code === 'KeyR' || event.key === '[') {
                this._rotate(-step);
                event.preventDefault();
            } else if (event.code === 'KeyE' || event.key === ']') {
                this._rotate(step);
                event.preventDefault();
            }
        }
        
        // Высота: Page Up/Down
        if (event.key === 'PageUp') {
            underlay.adjustElevation(1);
            // Обновляем здания группы
            if (this.groupManager) {
                const group = this.groupManager.getGroupByUnderlay(underlay.id);
                if (group) {
                    this.groupManager.updateBuildingsPosition(group);
                }
            }
            this.onChange(underlay);
            event.preventDefault();
        } else if (event.key === 'PageDown') {
            underlay.adjustElevation(-1);
            if (this.groupManager) {
                const group = this.groupManager.getGroupByUnderlay(underlay.id);
                if (group) {
                    this.groupManager.updateBuildingsPosition(group);
                }
            }
            this.onChange(underlay);
            event.preventDefault();
        }
    }
    
    _onWheel(event) {
        if (!this.enabled || !this.isMoving) return;
        
        const underlay = this.underlayManager.getSelected();
        if (!underlay) return;
        
        event.preventDefault();
        
        const step = event.shiftKey ? this.rotationStepFine : this.rotationStep;
        const direction = event.deltaY > 0 ? 1 : -1;
        
        this._rotate(direction * step);
    }
    
    _rotate(angle) {
        const underlay = this.underlayManager.getSelected();
        if (!underlay) return;
        
        let newRotation = underlay.rotation + angle;
        
        // Нормализуем
        while (newRotation > Math.PI) newRotation -= Math.PI * 2;
        while (newRotation < -Math.PI) newRotation += Math.PI * 2;
        
        underlay.setRotation(newRotation);
        
        // Обновляем здания группы
        if (this.groupManager) {
            const group = this.groupManager.getGroupByUnderlay(underlay.id);
            if (group) {
                this.groupManager.updateBuildingsPosition(group);
            }
        }
    }
    
    /**
     * Выбрать подложку по ID (программно)
     */
    selectById(id) {
        this.underlayManager.select(id);
        const underlay = this.underlayManager.getSelected();
        if (underlay) {
            this.onSelect(underlay);
        }
    }
}

export { UnderlayTool };
