/**
 * ============================================
 * MoveTool.js
 * Перемещение зданий, деревьев и подложек (click-to-start, click-to-finish)
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
        this.selectedTree = null;      // Для деревьев
        this.selectedUnderlay = null;  // Для подложек
        this.isMoving = false;
        
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
        this.startBuildingPositions = [];
        
        // Поворот
        this.rotationStep = Math.PI / 36;
        this.rotationStepFine = Math.PI / 180;
        
        // Подсветка
        this.highlightColor = 0xffaa00;
        this.originalColors = new Map();
        
        this.onChange = options.onChange || (() => {});
        this.onMove = options.onMove || (() => {});
        
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
    
    _getTreesGroup() {
        return this.sceneManager.scene.getObjectByName('trees');
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
        
        this._cancelMove();
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
     * Raycast для деревьев
     */
    _raycastTrees() {
        const treesGroup = this._getTreesGroup();
        if (!treesGroup || treesGroup.children.length === 0) return null;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const intersects = this.raycaster.intersectObjects(treesGroup.children, true);
        
        if (intersects.length > 0) {
            // Найти родительскую группу дерева
            let obj = intersects[0].object;
            while (obj.parent && obj.userData.type !== 'tree') {
                obj = obj.parent;
            }
            if (obj.userData.type === 'tree') {
                return { object: obj, distance: intersects[0].distance };
            }
        }
        
        return null;
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
        
        // Для деревьев подсвечиваем через TreeMesh
        if (mesh.userData.type === 'tree') {
            if (window.app?.state?.treeTool?.treeMesh) {
                window.app.state.treeTool.treeMesh.highlight(mesh);
            }
            return;
        }
        
        if (!this.originalColors.has(mesh.uuid)) {
            this.originalColors.set(mesh.uuid, mesh.material.color.getHex());
        }
        mesh.material.color.setHex(this.highlightColor);
    }
    
    _restoreColor(mesh) {
        if (!mesh) return;
        
        // Для деревьев
        if (mesh.userData.type === 'tree') {
            if (window.app?.state?.treeTool?.treeMesh) {
                window.app.state.treeTool.treeMesh.unhighlight(mesh);
            }
            return;
        }
        
        if (this.originalColors.has(mesh.uuid)) {
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
            } else if (this.selectedTree) {
                this._finishMoveTree();
            } else {
                this._finishMove();
            }
        } else {
            // Первый клик — проверяем объекты по приоритету
            
            // 1. Подложки
            const underlay = this._raycastUnderlay();
            if (underlay) {
                this._startMoveUnderlay(underlay);
                return;
            }
            
            // 2. Деревья
            const treeHit = this._raycastTrees();
            if (treeHit) {
                this._startMoveTree(treeHit.object);
                return;
            }
            
            // 3. Здания
            const intersect = this._raycastBuildings();
            if (intersect) {
                const mesh = intersect.object;
                
                const groupManager = window.app?.state?.groupManager;
                if (groupManager && mesh.userData.groupId) {
                    const group = groupManager.getGroup(mesh.userData.groupId);
                    if (group && group.underlay) {
                        this._startMoveUnderlay(group.underlay);
                        return;
                    }
                }
                
                this._startMove(mesh);
            }
        }
    }
    
    // ==================== Перемещение зданий ====================
    
    _startMove(mesh) {
        this._restoreColor(this.selectedMesh);
        
        this.selectedMesh = mesh;
        this.isMoving = true;
        
        this._highlightMesh(mesh);
        
        this.meshStartPos.copy(mesh.position);
        this.meshStartRotation = mesh.rotation.z;
        
        const groundPoint = this._getGroundPoint();
        this.moveOffset.set(
            mesh.position.x - groundPoint.x,
            mesh.position.y - groundPoint.y,
            0
        );
        
        this.controls.enabled = false;
        this.renderer.domElement.style.cursor = 'grabbing';
        
        console.log('[MoveTool] Начато перемещение здания:', mesh.userData.id);
    }
    
    _finishMove() {
        if (!this.selectedMesh) return;
        
        const deltaX = this.selectedMesh.position.x - this.meshStartPos.x;
        const deltaY = this.selectedMesh.position.y - this.meshStartPos.y;
        const deltaRotation = this.selectedMesh.rotation.z - this.meshStartRotation;
        
        // Обновляем basePoints если есть
        if (this.selectedMesh.userData.basePoints && (deltaX !== 0 || deltaY !== 0 || deltaRotation !== 0)) {
            this._updateBasePoints(this.selectedMesh, deltaX, deltaY, deltaRotation);
        }
        
        console.log(`[MoveTool] Завершено: dx=${deltaX.toFixed(2)}, dy=${deltaY.toFixed(2)}, rot=${(deltaRotation * 180 / Math.PI).toFixed(1)}°`);
        
        this._restoreColor(this.selectedMesh);
        this.onChange(this.selectedMesh);
        
        // Инвалидируем кэш
        if (window.app?.state?.insolationCalculator) {
            window.app.state.insolationCalculator.invalidateObstaclesCache();
        }
        
        this.selectedMesh = null;
        this.isMoving = false;
        this.controls.enabled = true;
        this.renderer.domElement.style.cursor = 'move';
    }
    
    // ==================== Перемещение деревьев ====================
    
    _startMoveTree(tree) {
        this._restoreColor(this.selectedTree);
        
        this.selectedTree = tree;
        this.isMoving = true;
        
        this._highlightMesh(tree);
        
        this.meshStartPos.copy(tree.position);
        this.meshStartRotation = tree.rotation.z;
        
        const groundPoint = this._getGroundPoint();
        this.moveOffset.set(
            tree.position.x - groundPoint.x,
            tree.position.y - groundPoint.y,
            0
        );
        
        this.controls.enabled = false;
        this.renderer.domElement.style.cursor = 'grabbing';
        
        console.log('[MoveTool] Начато перемещение дерева:', tree.userData.id);
    }
    
    _finishMoveTree() {
        if (!this.selectedTree) return;
        
        const deltaX = this.selectedTree.position.x - this.meshStartPos.x;
        const deltaY = this.selectedTree.position.y - this.meshStartPos.y;
        
        console.log(`[MoveTool] Дерево перемещено: dx=${deltaX.toFixed(2)}, dy=${deltaY.toFixed(2)}`);
        
        this._restoreColor(this.selectedTree);
        
        // Обновляем crownBounds
        if (this.selectedTree.userData.crownBounds) {
            this.selectedTree.userData.crownBounds.center.x = this.selectedTree.position.x;
            this.selectedTree.userData.crownBounds.center.y = this.selectedTree.position.y;
        }
        
        // Вызываем callback
        if (window.app?.bus) {
            window.app.bus.emit('tree:updated', { tree: this.selectedTree });
        }
        
        this.selectedTree = null;
        this.isMoving = false;
        this.controls.enabled = true;
        this.renderer.domElement.style.cursor = 'move';
    }
    
    // ==================== Перемещение подложек ====================
    
    _startMoveUnderlay(underlay) {
        this.selectedUnderlay = underlay;
        this.isMoving = true;
        
        underlay.setSelected(true, false);
        
        this.underlayStartPos = { x: underlay.position.x, y: underlay.position.y };
        this.underlayStartRotation = underlay.rotation;
        
        const groundPoint = this._getGroundPoint();
        this.underlayMoveOffset = {
            x: underlay.position.x - groundPoint.x,
            y: underlay.position.y - groundPoint.y
        };
        
        // Сохраняем позиции зданий группы
        this.startBuildingPositions = [];
        const groupManager = window.app?.state?.groupManager;
        if (groupManager) {
            const group = groupManager.getGroupByUnderlay(underlay.id);
            if (group) {
                const buildingsGroup = this._getBuildingsGroup();
                for (const bId of group.buildingIds) {
                    const building = buildingsGroup.children.find(c => c.userData.id === bId);
                    if (building) {
                        this.startBuildingPositions.push({
                            building,
                            x: building.position.x,
                            y: building.position.y,
                            rotationZ: building.rotation.z
                        });
                    }
                }
            }
        }
        
        this.controls.enabled = false;
        this.renderer.domElement.style.cursor = 'grabbing';
        
        console.log('[MoveTool] Начато перемещение подложки:', underlay.name);
    }
    
    _finishMoveUnderlay() {
        if (!this.selectedUnderlay) return;
        
        const underlay = this.selectedUnderlay;
        
        console.log(`[MoveTool] Подложка перемещена: ${underlay.name}`);
        
        underlay.setSelected(false);
        
        // Инвалидируем кэш
        if (window.app?.state?.insolationCalculator) {
            window.app.state.insolationCalculator.invalidateObstaclesCache();
        }
        
        this.selectedUnderlay = null;
        this.startBuildingPositions = [];
        this.isMoving = false;
        this.controls.enabled = true;
        this.renderer.domElement.style.cursor = 'move';
    }
    
    _cancelMove() {
        if (this.selectedUnderlay) {
            this.selectedUnderlay.setPosition(this.underlayStartPos.x, this.underlayStartPos.y);
            this.selectedUnderlay.setRotation(this.underlayStartRotation);
            this.selectedUnderlay.setSelected(false);
            
            for (const saved of this.startBuildingPositions) {
                saved.building.position.x = saved.x;
                saved.building.position.y = saved.y;
                saved.building.rotation.z = saved.rotationZ;
            }
            
            this.selectedUnderlay = null;
            this.startBuildingPositions = [];
            
        } else if (this.selectedTree) {
            this.selectedTree.position.copy(this.meshStartPos);
            this.selectedTree.rotation.z = this.meshStartRotation;
            this._restoreColor(this.selectedTree);
            this.selectedTree = null;
            
        } else if (this.selectedMesh) {
            this.selectedMesh.position.copy(this.meshStartPos);
            this.selectedMesh.rotation.z = this.meshStartRotation;
            this._restoreColor(this.selectedMesh);
            this.selectedMesh = null;
        }
        
        this.isMoving = false;
        this.controls.enabled = true;
        
        if (this.enabled) {
            this.renderer.domElement.style.cursor = 'move';
        }
        
        console.log('[MoveTool] Перемещение отменено');
    }
    
    _updateBasePoints(mesh, deltaX, deltaY, deltaRotation) {
        const points = mesh.userData.basePoints;
        if (!points || points.length === 0) return;
        
        // Центр для вращения
        let cx = 0, cy = 0;
        for (const p of points) {
            cx += p.x;
            cy += p.y;
        }
        cx /= points.length;
        cy /= points.length;
        
        const cos = Math.cos(deltaRotation);
        const sin = Math.sin(deltaRotation);
        
        for (const p of points) {
            const rx = p.x - cx;
            const ry = p.y - cy;
            
            p.x = cx + rx * cos - ry * sin + deltaX;
            p.y = cy + rx * sin + ry * cos + deltaY;
        }
    }
    
    _rotateUnderlay(angle) {
        if (!this.selectedUnderlay) return;
        
        const newRotation = this.selectedUnderlay.rotation + angle;
        this.selectedUnderlay.setRotation(newRotation);
        
        this._updateGroupBuildingsPositions();
    }
    
    _updateGroupBuildingsPositions() {
        const underlay = this.selectedUnderlay;
        if (!underlay || this.startBuildingPositions.length === 0) return;
        
        const deltaMoveX = underlay.position.x - this.underlayStartPos.x;
        const deltaMoveY = underlay.position.y - this.underlayStartPos.y;
        const deltaRotation = underlay.rotation - this.underlayStartRotation;
        
        const startCenterX = this.underlayStartPos.x + underlay.originalBounds.centerX;
        const startCenterY = this.underlayStartPos.y + underlay.originalBounds.centerY;
        
        const currentCenterX = startCenterX + deltaMoveX;
        const currentCenterY = startCenterY + deltaMoveY;
        
        const cos = Math.cos(deltaRotation);
        const sin = Math.sin(deltaRotation);
        
        for (const saved of this.startBuildingPositions) {
            const offsetX = saved.x - startCenterX;
            const offsetY = saved.y - startCenterY;
            
            const rotatedOffsetX = offsetX * cos - offsetY * sin;
            const rotatedOffsetY = offsetX * sin + offsetY * cos;
            
            saved.building.position.x = currentCenterX + rotatedOffsetX;
            saved.building.position.y = currentCenterY + rotatedOffsetY;
            saved.building.rotation.z = saved.rotationZ + deltaRotation;
            
            saved.building.updateMatrixWorld(true);
            
            const insolationGrid = window.app?.state?.insolationGrid;
            if (insolationGrid && insolationGrid.isMeshActive(saved.building)) {
                insolationGrid.syncWithMesh(saved.building);
            }
        }
        
        this._throttledOnMoveGroup();
    }
    
    _onMouseMove(event) {
        if (!this.enabled) return;
        
        this._getMousePosition(event);
        
        if (this.isMoving && this.selectedUnderlay) {
            const groundPoint = this._getGroundPoint();
            
            const newX = groundPoint.x + this.underlayMoveOffset.x;
            const newY = groundPoint.y + this.underlayMoveOffset.y;
            
            this.selectedUnderlay.setPosition(newX, newY);
            this._updateGroupBuildingsPositions();
            
        } else if (this.isMoving && this.selectedTree) {
            const groundPoint = this._getGroundPoint();
            
            this.selectedTree.position.x = groundPoint.x + this.moveOffset.x;
            this.selectedTree.position.y = groundPoint.y + this.moveOffset.y;
            
        } else if (this.isMoving && this.selectedMesh) {
            const groundPoint = this._getGroundPoint();
            
            this.selectedMesh.position.x = groundPoint.x + this.moveOffset.x;
            this.selectedMesh.position.y = groundPoint.y + this.moveOffset.y;
            
            this._throttledOnMove();
            
        } else {
            // Hover эффект
            const underlay = this._raycastUnderlay();
            if (underlay) {
                this.renderer.domElement.style.cursor = 'grab';
                return;
            }
            const treeHit = this._raycastTrees();
            if (treeHit) {
                this.renderer.domElement.style.cursor = 'grab';
                return;
            }
            const intersect = this._raycastBuildings();
            this.renderer.domElement.style.cursor = intersect ? 'grab' : 'move';
        }
    }
    
    _throttledOnMove() {
        const now = Date.now();
        if (!this._lastMoveCall || now - this._lastMoveCall > 50) {
            this._lastMoveCall = now;
            this.onMove(this.selectedMesh);
        }
    }
    
    _throttledOnMoveGroup() {
        const now = Date.now();
        if (!this._lastMoveCall || now - this._lastMoveCall > 50) {
            this._lastMoveCall = now;
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
        
        if (this.isMoving) {
            const step = event.shiftKey ? this.rotationStepFine : this.rotationStep;
            
            if (this.selectedUnderlay) {
                if (event.code === 'KeyR' || event.key === '[') {
                    this._rotateUnderlay(-step);
                    event.preventDefault();
                } else if (event.code === 'KeyE' || event.key === ']') {
                    this._rotateUnderlay(step);
                    event.preventDefault();
                }
            } else if (this.selectedTree) {
                // Деревья можно вращать (эллиптическая крона)
                if (event.code === 'KeyR' || event.key === '[') {
                    this._rotateTree(-step);
                    event.preventDefault();
                } else if (event.code === 'KeyE' || event.key === ']') {
                    this._rotateTree(step);
                    event.preventDefault();
                }
            } else if (this.selectedMesh) {
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
        } else if (this.selectedTree) {
            this._rotateTree(direction * step);
        } else if (this.selectedMesh) {
            this._rotate(direction * step);
        }
    }
    
    _rotate(angle) {
        if (!this.selectedMesh) return;
        
        if (!this.selectedMesh.geometry.boundingBox) {
            this.selectedMesh.geometry.computeBoundingBox();
        }
        const centerBefore = new THREE.Vector3();
        this.selectedMesh.geometry.boundingBox.getCenter(centerBefore);
        centerBefore.applyMatrix4(this.selectedMesh.matrixWorld);
        
        this.selectedMesh.rotation.z += angle;
        
        while (this.selectedMesh.rotation.z > Math.PI) {
            this.selectedMesh.rotation.z -= 2 * Math.PI;
        }
        while (this.selectedMesh.rotation.z < -Math.PI) {
            this.selectedMesh.rotation.z += 2 * Math.PI;
        }
        
        this.selectedMesh.updateMatrixWorld();
        const centerAfter = new THREE.Vector3();
        this.selectedMesh.geometry.boundingBox.getCenter(centerAfter);
        centerAfter.applyMatrix4(this.selectedMesh.matrixWorld);
        
        const dx = centerBefore.x - centerAfter.x;
        const dy = centerBefore.y - centerAfter.y;
        this.selectedMesh.position.x += dx;
        this.selectedMesh.position.y += dy;
        
        this.moveOffset.x += dx;
        this.moveOffset.y += dy;
        
        this._throttledOnMove();
    }
    
    _rotateTree(angle) {
        if (!this.selectedTree) return;
        
        this.selectedTree.rotation.z += angle;
        
        while (this.selectedTree.rotation.z > Math.PI) {
            this.selectedTree.rotation.z -= 2 * Math.PI;
        }
        while (this.selectedTree.rotation.z < -Math.PI) {
            this.selectedTree.rotation.z += 2 * Math.PI;
        }
    }
    
    /**
     * Принудительный сброс состояния
     */
    forceReset() {
        if (this.selectedMesh) {
            this._restoreColor(this.selectedMesh);
        }
        if (this.selectedTree) {
            this._restoreColor(this.selectedTree);
        }
        
        this.selectedMesh = null;
        this.selectedTree = null;
        this.selectedUnderlay = null;
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