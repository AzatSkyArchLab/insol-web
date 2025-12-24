/**
 * ============================================
 * MoveTool.js
 * Перемещение зданий и подложек (click-to-start, click-to-finish)
 * ============================================
 */

class MoveTool {
    constructor(sceneManager, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        this.camera = sceneManager.camera;
        this.renderer = sceneManager.renderer;
        this.controls = sceneManager.controls;
        
        this.enabled = false;
        this.selectedMesh = null;
        this.selectedUnderlay = null;  // Для подложек
        this.isMoving = false;  // Режим перемещения (между первым и вторым кликом)
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        this.meshStartPos = new THREE.Vector3();
        this.meshStartRotation = 0;
        this.moveOffset = new THREE.Vector3();
        
        // Для подложек
        this.underlayStartPos = { x: 0, y: 0 };
        this.underlayStartRotation = 0;
        this.underlayMoveOffset = { x: 0, y: 0 };
        this.startBuildingPositions = [];  // Для групп
        
        // Поворот
        this.rotationStep = Math.PI / 36;  // 5 градусов
        this.rotationStepFine = Math.PI / 180;  // 1 градус (с Shift)
        
        // Подсветка
        this.highlightColor = 0xffaa00;
        this.originalColors = new Map();
        
        this.onChange = options.onChange || (() => {});
        this.onMove = options.onMove || (() => {});  // Вызывается во время перемещения
        
        this._boundOnClick = this._onClick.bind(this);
        this._boundOnMouseMove = this._onMouseMove.bind(this);
        this._boundOnRightClick = this._onRightClick.bind(this);
        this._boundOnKeyDown = this._onKeyDown.bind(this);
        this._boundOnWheel = this._onWheel.bind(this);
        
        console.log('[MoveTool] Создан');
    }
    
    _getBuildingsGroup() {
        return this.sceneManager.getBuildingsGroup();
    }
    
    enable() {
        if (this.enabled) return;
        this.enabled = true;
        
        const canvas = this.renderer.domElement;
        
        canvas.addEventListener('click', this._boundOnClick);
        canvas.addEventListener('mousemove', this._boundOnMouseMove);
        canvas.addEventListener('contextmenu', this._boundOnRightClick);
        canvas.addEventListener('wheel', this._boundOnWheel, { passive: false });
        document.addEventListener('keydown', this._boundOnKeyDown);
        
        canvas.style.cursor = 'move';
        
        console.log('[MoveTool] Включен');
    }
    
    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        
        const canvas = this.renderer.domElement;
        
        canvas.removeEventListener('click', this._boundOnClick);
        canvas.removeEventListener('mousemove', this._boundOnMouseMove);
        canvas.removeEventListener('contextmenu', this._boundOnRightClick);
        canvas.removeEventListener('wheel', this._boundOnWheel);
        document.removeEventListener('keydown', this._boundOnKeyDown);
        
        canvas.style.cursor = 'default';
        
        // Отменяем перемещение если было активно
        this._cancelMove();
        
        // Гарантируем что камера разблокирована
        this.controls.enabled = true;
        
        console.log('[MoveTool] Выключен');
    }
    
    _getMousePosition(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }
    
    _raycastBuildings() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const buildingsGroup = this._getBuildingsGroup();
        
        const buildings = buildingsGroup.children.filter(child => {
            return child.visible && child.userData.type === 'building';
        });
        
        if (buildings.length === 0) return null;
        
        const intersects = this.raycaster.intersectObjects(buildings, false);
        return intersects.length > 0 ? intersects[0] : null;
    }
    
    /**
     * Raycast для подложек
     */
    _raycastUnderlay() {
        if (!window.app?.state?.underlayManager) return null;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        return window.app.state.underlayManager.raycast(this.raycaster);
    }
    
    _getGroundPoint() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const point = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(this.groundPlane, point);
        return point;
    }
    
    _highlightMesh(mesh) {
        if (!mesh) return;
        
        if (!this.originalColors.has(mesh.uuid)) {
            this.originalColors.set(mesh.uuid, mesh.material.color.getHex());
        }
        mesh.material.color.setHex(this.highlightColor);
    }
    
    _restoreColor(mesh) {
        if (mesh && this.originalColors.has(mesh.uuid)) {
            mesh.material.color.setHex(this.originalColors.get(mesh.uuid));
        }
    }
    
    _onClick(event) {
        if (!this.enabled) return;
        
        this._getMousePosition(event);
        
        if (this.isMoving) {
            // Второй клик — завершить перемещение
            if (this.selectedUnderlay) {
                this._finishMoveUnderlay();
            } else {
                this._finishMove();
            }
        } else {
            // Первый клик — сначала проверяем подложки
            const underlay = this._raycastUnderlay();
            if (underlay) {
                this._startMoveUnderlay(underlay);
                return;
            }
            
            // Потом здания
            const intersect = this._raycastBuildings();
            if (intersect) {
                const mesh = intersect.object;
                
                // Проверяем, является ли здание частью группы
                const groupManager = window.app?.state?.groupManager;
                if (groupManager && mesh.userData.groupId) {
                    const group = groupManager.getGroup(mesh.userData.groupId);
                    if (group && group.underlay) {
                        // Перемещаем группу через подложку
                        this._startMoveUnderlay(group.underlay);
                        return;
                    }
                }
                
                // Обычное перемещение здания
                this._startMove(mesh);
            }
        }
    }
    
    _startMove(mesh) {
        this._restoreColor(this.selectedMesh);
        
        this.selectedMesh = mesh;
        this.isMoving = true;
        
        this._highlightMesh(mesh);
        
        // Запоминаем начальную позицию и поворот
        this.meshStartPos.copy(mesh.position);
        this.meshStartRotation = mesh.rotation.z;
        
        // Вычисляем offset от курсора до центра здания
        const groundPoint = this._getGroundPoint();
        this.moveOffset.set(
            mesh.position.x - groundPoint.x,
            mesh.position.y - groundPoint.y,
            0
        );
        
        // Блокируем камеру
        this.controls.enabled = false;
        
        this.renderer.domElement.style.cursor = 'grabbing';
        
        console.log('[MoveTool] Начато перемещение:', mesh.userData.id);
    }
    
    _finishMove() {
        if (!this.selectedMesh) return;
        
        const deltaX = this.selectedMesh.position.x - this.meshStartPos.x;
        const deltaY = this.selectedMesh.position.y - this.meshStartPos.y;
        const deltaRotation = this.selectedMesh.rotation.z - this.meshStartRotation;
        
        // Обновляем basePoints если есть
        if (this.selectedMesh.userData.basePoints) {
            // Получаем центр здания (в локальных координатах до смещения)
            const center = this._getBasePointsCenter(this.selectedMesh.userData.basePoints);
            
            this.selectedMesh.userData.basePoints = this.selectedMesh.userData.basePoints.map(p => {
                // Сдвигаем к центру
                let x = p.x - center.x;
                let y = p.y - center.y;
                
                // Поворачиваем
                if (deltaRotation !== 0) {
                    const cos = Math.cos(deltaRotation);
                    const sin = Math.sin(deltaRotation);
                    const newX = x * cos - y * sin;
                    const newY = x * sin + y * cos;
                    x = newX;
                    y = newY;
                }
                
                // Возвращаем от центра + смещение
                return {
                    x: x + center.x + deltaX,
                    y: y + center.y + deltaY
                };
            });
        }
        
        console.log('[MoveTool] Завершено перемещение:', this.selectedMesh.userData.id, 
                    `(dx: ${deltaX.toFixed(1)}, dy: ${deltaY.toFixed(1)}, rot: ${(deltaRotation * 180 / Math.PI).toFixed(1)}°)`);
        this.onChange(this.selectedMesh);
        
        this._restoreColor(this.selectedMesh);
        this.selectedMesh = null;
        this.isMoving = false;
        
        // Разблокируем камеру
        this.controls.enabled = true;
        
        this.renderer.domElement.style.cursor = 'move';
    }
    
    _getBasePointsCenter(points) {
        let sumX = 0, sumY = 0;
        for (const p of points) {
            sumX += p.x;
            sumY += p.y;
        }
        return {
            x: sumX / points.length,
            y: sumY / points.length
        };
    }
    
    _cancelMove() {
        if (!this.isMoving) return;
        
        if (this.selectedUnderlay) {
            this._cancelMoveUnderlay();
            return;
        }
        
        if (!this.selectedMesh) return;
        
        // Возвращаем здание на исходную позицию и поворот
        this.selectedMesh.position.copy(this.meshStartPos);
        this.selectedMesh.rotation.z = this.meshStartRotation;
        
        // Синхронизируем сетку с исходной позицией
        this.onMove(this.selectedMesh);
        
        console.log('[MoveTool] Отменено перемещение:', this.selectedMesh.userData.id);
        
        this._restoreColor(this.selectedMesh);
        this.selectedMesh = null;
        this.isMoving = false;
        
        // Разблокируем камеру
        this.controls.enabled = true;
        
        this.renderer.domElement.style.cursor = 'move';
    }
    
    // =============================================
    // Методы для подложек
    // =============================================
    
    _startMoveUnderlay(underlay) {
        this.selectedUnderlay = underlay;
        this.isMoving = true;

        // Скрываем лучи инсоляции при начале перемещения (чтобы избежать артефактов)
        const calculator = window.app?.state?.insolationCalculator;
        if (calculator) {
            calculator.hideRays();
            calculator.hideAllRays();
        }
        
        // Запоминаем начальную позицию подложки
        this.underlayStartPos.x = underlay.position.x;
        this.underlayStartPos.y = underlay.position.y;
        this.underlayStartRotation = underlay.rotation;
        
        // Сохраняем позиции и повороты зданий группы для отката и дельта-перемещения
        this.startBuildingPositions = [];
        const groupManager = window.app?.state?.groupManager;
        if (groupManager) {
            const group = groupManager.getGroupByUnderlay(underlay.id);
            if (group) {
                for (const building of group.buildings) {
                    this.startBuildingPositions.push({
                        building,
                        x: building.position.x,
                        y: building.position.y,
                        z: building.position.z,
                        rotationZ: building.rotation.z
                    });
                }
            }
        }
        
        // Offset от курсора
        const groundPoint = this._getGroundPoint();
        this.underlayMoveOffset.x = underlay.position.x - groundPoint.x;
        this.underlayMoveOffset.y = underlay.position.y - groundPoint.y;
        
        // Обновляем плоскость на высоту подложки
        this.groundPlane.constant = -underlay.elevation;
        
        // Выбираем подложку в менеджере
        const manager = window.app?.state?.underlayManager;
        if (manager) {
            manager.select(underlay.id);
        }
        
        this.controls.enabled = false;
        this.renderer.domElement.style.cursor = 'grabbing';
        
        console.log('[MoveTool] Начато перемещение подложки:', underlay.name);
    }
    
    _finishMoveUnderlay() {
        if (!this.selectedUnderlay) return;
        
        // Пересчитываем offsets группы для будущих перемещений
        const groupManager = window.app?.state?.groupManager;
        if (groupManager) {
            const group = groupManager.getGroupByUnderlay(this.selectedUnderlay.id);
            if (group) {
                groupManager.recalculateOffsets(group);
                
                // Уведомляем о перемещении каждого здания в группе
                for (const building of group.buildings) {
                    this.onChange(building);
                }
            }
        }
        
        console.log('[MoveTool] Завершено перемещение подложки:', this.selectedUnderlay.name);
        
        // Обновляем панель если открыта
        const panel = window.app?.controllers?.underlay?.panel;
        if (panel) {
            panel.refresh();
        }
        
        this.selectedUnderlay = null;
        this.isMoving = false;
        this.startBuildingPositions = [];
        
        this.groundPlane.constant = 0;
        this.controls.enabled = true;
        this.renderer.domElement.style.cursor = 'move';
    }
    
    _cancelMoveUnderlay() {
        if (!this.selectedUnderlay) return;
        
        // Возвращаем подложку
        this.selectedUnderlay.setPosition(this.underlayStartPos.x, this.underlayStartPos.y);
        this.selectedUnderlay.setRotation(this.underlayStartRotation);
        
        // Возвращаем здания группы (позиции и повороты)
        for (const saved of this.startBuildingPositions) {
            saved.building.position.set(saved.x, saved.y, saved.z);
            saved.building.rotation.z = saved.rotationZ;
            saved.building.updateMatrixWorld(true);
            
            // Синхронизируем инсоляционную сетку
            const insolationGrid = window.app?.state?.insolationGrid;
            if (insolationGrid && insolationGrid.isMeshActive(saved.building)) {
                insolationGrid.syncWithMesh(saved.building);
            }
        }
        
        console.log('[MoveTool] Отменено перемещение подложки:', this.selectedUnderlay.name);
        
        this.selectedUnderlay = null;
        this.isMoving = false;
        this.startBuildingPositions = [];
        
        this.groundPlane.constant = 0;
        this.controls.enabled = true;
        this.renderer.domElement.style.cursor = 'move';
    }
    
    _rotateUnderlay(angle) {
        if (!this.selectedUnderlay) return;
        
        let newRotation = this.selectedUnderlay.rotation + angle;
        
        // Нормализуем
        while (newRotation > Math.PI) newRotation -= Math.PI * 2;
        while (newRotation < -Math.PI) newRotation += Math.PI * 2;
        
        this.selectedUnderlay.setRotation(newRotation);
        
        // Обновляем позиции зданий (та же логика что и при перемещении)
        this._updateGroupBuildingsPositions();
    }
    
    /**
     * Обновить позиции зданий группы с учётом перемещения и поворота подложки
     */
    _updateGroupBuildingsPositions() {
        if (!this.selectedUnderlay || this.startBuildingPositions.length === 0) return;
        
        const underlay = this.selectedUnderlay;
        
        // Дельты от начального положения
        const deltaMoveX = underlay.position.x - this.underlayStartPos.x;
        const deltaMoveY = underlay.position.y - this.underlayStartPos.y;
        const deltaRotation = underlay.rotation - this.underlayStartRotation;
        
        // Начальный центр подложки
        const startCenterX = this.underlayStartPos.x + underlay.originalBounds.centerX;
        const startCenterY = this.underlayStartPos.y + underlay.originalBounds.centerY;
        
        // Текущий центр подложки
        const currentCenterX = startCenterX + deltaMoveX;
        const currentCenterY = startCenterY + deltaMoveY;
        
        const cos = Math.cos(deltaRotation);
        const sin = Math.sin(deltaRotation);
        
        for (const saved of this.startBuildingPositions) {
            // Начальный offset от начального центра
            const offsetX = saved.x - startCenterX;
            const offsetY = saved.y - startCenterY;
            
            // Поворачиваем offset
            const rotatedOffsetX = offsetX * cos - offsetY * sin;
            const rotatedOffsetY = offsetX * sin + offsetY * cos;
            
            // Новая позиция
            saved.building.position.x = currentCenterX + rotatedOffsetX;
            saved.building.position.y = currentCenterY + rotatedOffsetY;
            saved.building.rotation.z = saved.rotationZ + deltaRotation;
            
            saved.building.updateMatrixWorld(true);
            
            // Синхронизируем инсоляционную сетку
            const insolationGrid = window.app?.state?.insolationGrid;
            if (insolationGrid && insolationGrid.isMeshActive(saved.building)) {
                insolationGrid.syncWithMesh(saved.building);
            }
        }
        
        // Real-time обновление инсоляции
        this._throttledOnMoveGroup();
    }
    
    _onMouseMove(event) {
        if (!this.enabled) return;
        
        this._getMousePosition(event);
        
        if (this.isMoving && this.selectedUnderlay) {
            // Перемещаем подложку за курсором
            const groundPoint = this._getGroundPoint();
            
            const newX = groundPoint.x + this.underlayMoveOffset.x;
            const newY = groundPoint.y + this.underlayMoveOffset.y;
            
            this.selectedUnderlay.setPosition(newX, newY);
            
            // Обновляем позиции зданий группы
            this._updateGroupBuildingsPositions();
            
        } else if (this.isMoving && this.selectedMesh) {
            // Перемещаем здание за курсором
            const groundPoint = this._getGroundPoint();
            
            this.selectedMesh.position.x = groundPoint.x + this.moveOffset.x;
            this.selectedMesh.position.y = groundPoint.y + this.moveOffset.y;
            
            // Throttled callback для реального времени
            this._throttledOnMove();
            
        } else {
            // Hover эффект — проверяем и подложки, и здания
            const underlay = this._raycastUnderlay();
            if (underlay) {
                this.renderer.domElement.style.cursor = 'grab';
                return;
            }
            const intersect = this._raycastBuildings();
            this.renderer.domElement.style.cursor = intersect ? 'grab' : 'move';
        }
    }
    
    _throttledOnMove() {
        const now = Date.now();
        if (!this._lastMoveCall || now - this._lastMoveCall > 50) {  // 50ms throttle для плавности
            this._lastMoveCall = now;
            this.onMove(this.selectedMesh);
        }
    }
    
    _throttledOnMoveGroup() {
        const now = Date.now();
        if (!this._lastMoveCall || now - this._lastMoveCall > 50) {
            this._lastMoveCall = now;
            // Вызываем onMove для каждого здания группы
            for (const saved of this.startBuildingPositions) {
                this.onMove(saved.building);
            }
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
        
        if (event.key === 'Escape' && this.isMoving) {
            this._cancelMove();
            return;
        }
        
        // Поворот клавишами R/E или [/] (работает с любой раскладкой)
        if (this.isMoving) {
            const step = event.shiftKey ? this.rotationStepFine : this.rotationStep;
            
            if (this.selectedUnderlay) {
                // Поворот подложки
                if (event.code === 'KeyR' || event.key === '[') {
                    this._rotateUnderlay(-step);
                    event.preventDefault();
                } else if (event.code === 'KeyE' || event.key === ']') {
                    this._rotateUnderlay(step);
                    event.preventDefault();
                }
            } else if (this.selectedMesh) {
                // Поворот здания
                if (event.code === 'KeyR' || event.key === '[') {
                    this._rotate(-step);
                    event.preventDefault();
                } else if (event.code === 'KeyE' || event.key === ']') {
                    this._rotate(step);
                    event.preventDefault();
                }
            }
        }
    }
    
    _onWheel(event) {
        if (!this.enabled || !this.isMoving) return;
        
        event.preventDefault();
        
        const step = event.shiftKey ? this.rotationStepFine : this.rotationStep;
        const direction = event.deltaY > 0 ? 1 : -1;
        
        if (this.selectedUnderlay) {
            this._rotateUnderlay(direction * step);
        } else if (this.selectedMesh) {
            this._rotate(direction * step);
        }
    }
    
    _rotate(angle) {
        if (!this.selectedMesh) return;
        
        // Получаем центр геометрии в мировых координатах ДО вращения
        if (!this.selectedMesh.geometry.boundingBox) {
            this.selectedMesh.geometry.computeBoundingBox();
        }
        const centerBefore = new THREE.Vector3();
        this.selectedMesh.geometry.boundingBox.getCenter(centerBefore);
        centerBefore.applyMatrix4(this.selectedMesh.matrixWorld);
        
        // Вращаем меш
        this.selectedMesh.rotation.z += angle;
        
        // Нормализуем угол в диапазон [-PI, PI]
        while (this.selectedMesh.rotation.z > Math.PI) {
            this.selectedMesh.rotation.z -= 2 * Math.PI;
        }
        while (this.selectedMesh.rotation.z < -Math.PI) {
            this.selectedMesh.rotation.z += 2 * Math.PI;
        }
        
        // Обновляем матрицу и получаем центр ПОСЛЕ вращения
        this.selectedMesh.updateMatrixWorld();
        const centerAfter = new THREE.Vector3();
        this.selectedMesh.geometry.boundingBox.getCenter(centerAfter);
        centerAfter.applyMatrix4(this.selectedMesh.matrixWorld);
        
        // Корректируем position чтобы центр остался на месте
        const dx = centerBefore.x - centerAfter.x;
        const dy = centerBefore.y - centerAfter.y;
        this.selectedMesh.position.x += dx;
        this.selectedMesh.position.y += dy;
        
        // Обновляем offset для корректного продолжения перемещения
        this.moveOffset.x += dx;
        this.moveOffset.y += dy;
        
        // Вызываем callback для перерасчёта
        this._throttledOnMove();
    }
    
    /**
     * Принудительный сброс состояния (для удаления объекта)
     * Не пытается вернуть объект на место
     */
    forceReset() {
        if (this.selectedMesh) {
            this._restoreColor(this.selectedMesh);
        }
        
        this.selectedMesh = null;
        this.isMoving = false;
        this.controls.enabled = true;
        
        if (this.enabled) {
            this.renderer.domElement.style.cursor = 'move';
        }
        
        console.log('[MoveTool] Принудительный сброс');
    }
}

export { MoveTool };
window.MoveTool = MoveTool;