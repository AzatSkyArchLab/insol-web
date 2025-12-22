/**
 * ============================================
 * GroupManager.js
 * Менеджер групп (подложка + здания)
 * ============================================
 */

class GroupManager {
    constructor() {
        /** @type {Map<string, Group>} */
        this.groups = new Map();
        
        this._idCounter = 0;
        
        console.log('[GroupManager] Создан');
    }
    
    /**
     * Создать группу из выбранных объектов
     * @param {Underlay} underlay - подложка
     * @param {THREE.Mesh[]} buildings - массив зданий
     * @returns {Group}
     */
    createGroup(underlay, buildings) {
        const id = `group-${++this._idCounter}`;
        
        // Центр подложки в мировых координатах
        const underlayCenter = {
            x: underlay.position.x + underlay.originalBounds.centerX,
            y: underlay.position.y + underlay.originalBounds.centerY
        };
        
        // Сохраняем начальный угол подложки
        const initialRotation = underlay.rotation;
        
        // Вычисляем смещения зданий в ЛОКАЛЬНОЙ системе координат подложки
        const offsets = [];
        for (const building of buildings) {
            const bbox = new THREE.Box3().setFromObject(building);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            
            // Смещение от центра подложки в мировых координатах
            const dx = center.x - underlayCenter.x;
            const dy = center.y - underlayCenter.y;
            
            // Преобразуем в локальные координаты подложки (поворачиваем обратно)
            const cos = Math.cos(-initialRotation);
            const sin = Math.sin(-initialRotation);
            
            offsets.push({
                buildingId: building.userData.id,
                localX: dx * cos - dy * sin,
                localY: dx * sin + dy * cos,
                initialBuildingRotation: building.rotation.z // Сохраняем начальный поворот здания
            });
        }
        
        const group = {
            id,
            underlayId: underlay.id,
            underlay: underlay,
            buildingIds: buildings.map(b => b.userData.id),
            buildings: buildings,
            offsets: offsets,
            initialUnderlayRotation: initialRotation // Запоминаем начальный угол
        };
        
        this.groups.set(id, group);
        
        // Помечаем объекты как сгруппированные
        underlay.groupId = id;
        buildings.forEach(b => {
            b.userData.groupId = id;
        });
        
        console.log(`[GroupManager] Создана группа ${id}: подложка + ${buildings.length} зданий`);
        
        return group;
    }
    
    /**
     * Удалить группу (разгруппировать)
     * @param {string} groupId
     */
    dissolveGroup(groupId) {
        const group = this.groups.get(groupId);
        if (!group) return;
        
        // Снимаем пометки
        if (group.underlay) {
            group.underlay.groupId = null;
        }
        
        group.buildings.forEach(b => {
            if (b.userData) {
                b.userData.groupId = null;
            }
        });
        
        this.groups.delete(groupId);
        
        console.log(`[GroupManager] Группа ${groupId} расформирована`);
    }
    
    /**
     * Получить группу по ID
     * @param {string} groupId
     * @returns {Group|null}
     */
    getGroup(groupId) {
        return this.groups.get(groupId) || null;
    }
    
    /**
     * Получить группу по подложке
     * @param {string} underlayId
     * @returns {Group|null}
     */
    getGroupByUnderlay(underlayId) {
        for (const group of this.groups.values()) {
            if (group.underlayId === underlayId) {
                return group;
            }
        }
        return null;
    }
    
    /**
     * Получить группу по зданию
     * @param {string} buildingId
     * @returns {Group|null}
     */
    getGroupByBuilding(buildingId) {
        for (const group of this.groups.values()) {
            if (group.buildingIds.includes(buildingId)) {
                return group;
            }
        }
        return null;
    }
    
    /**
     * Обновить позиции и повороты зданий группы
     * @param {Group} group
     */
    updateBuildingsPosition(group) {
        const underlay = group.underlay;
        if (!underlay) return;
        
        // Центр подложки в мировых координатах
        const ux = underlay.position.x + underlay.originalBounds.centerX;
        const uy = underlay.position.y + underlay.originalBounds.centerY;
        
        // Текущий угол подложки
        const currentRotation = underlay.rotation;
        
        // Дельта поворота с момента создания группы
        const deltaRotation = currentRotation - group.initialUnderlayRotation;
        
        const cos = Math.cos(currentRotation);
        const sin = Math.sin(currentRotation);
        
        for (let i = 0; i < group.buildings.length; i++) {
            const building = group.buildings[i];
            const offset = group.offsets[i];
            
            if (!building || !offset) continue;
            
            // Целевой угол здания
            const targetRotation = offset.initialBuildingRotation + deltaRotation;
            
            // Текущий центр здания ДО поворота
            if (!building.geometry.boundingBox) {
                building.geometry.computeBoundingBox();
            }
            const centerBefore = new THREE.Vector3();
            building.geometry.boundingBox.getCenter(centerBefore);
            centerBefore.applyMatrix4(building.matrixWorld);
            
            // Устанавливаем новый угол
            building.rotation.z = targetRotation;
            building.updateMatrixWorld();
            
            // Центр здания ПОСЛЕ поворота
            const centerAfter = new THREE.Vector3();
            building.geometry.boundingBox.getCenter(centerAfter);
            centerAfter.applyMatrix4(building.matrixWorld);
            
            // Корректируем position чтобы центр остался на месте
            building.position.x += centerBefore.x - centerAfter.x;
            building.position.y += centerBefore.y - centerAfter.y;
            
            // Теперь перемещаем к целевой позиции
            building.updateMatrixWorld();
            const bbox = new THREE.Box3().setFromObject(building);
            const currentCenter = new THREE.Vector3();
            bbox.getCenter(currentCenter);
            
            // Вычисляем целевую мировую позицию центра здания
            const worldX = ux + offset.localX * cos - offset.localY * sin;
            const worldY = uy + offset.localX * sin + offset.localY * cos;
            
            // Смещаем здание к целевой позиции
            building.position.x += worldX - currentCenter.x;
            building.position.y += worldY - currentCenter.y;
            
            // Финальное обновление матрицы для корректного raycasting
            building.updateMatrixWorld(true);
            
            // Принудительно пересчитываем bounding volumes для raycasting
            if (building.geometry) {
                building.geometry.computeBoundingBox();
                building.geometry.computeBoundingSphere();
            }
            
            // Синхронизируем инсоляционную сетку
            const insolationGrid = window.app?.state?.insolationGrid;
            if (insolationGrid && insolationGrid.isMeshActive(building)) {
                insolationGrid.syncWithMesh(building);
            }
        }
    }
    
    /**
     * Пересчитать offsets после завершения перемещения
     * Вызывается когда пользователь закончил двигать группу
     * @param {Group} group
     */
    recalculateOffsets(group) {
        const underlay = group.underlay;
        if (!underlay) return;
        
        const underlayCenter = {
            x: underlay.position.x + underlay.originalBounds.centerX,
            y: underlay.position.y + underlay.originalBounds.centerY
        };
        
        const currentRotation = underlay.rotation;
        
        // Обновляем начальный угол
        group.initialUnderlayRotation = currentRotation;
        
        // Пересчитываем offsets
        for (let i = 0; i < group.buildings.length; i++) {
            const building = group.buildings[i];
            const offset = group.offsets[i];
            
            if (!building || !offset) continue;
            
            const bbox = new THREE.Box3().setFromObject(building);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            
            const dx = center.x - underlayCenter.x;
            const dy = center.y - underlayCenter.y;
            
            const cos = Math.cos(-currentRotation);
            const sin = Math.sin(-currentRotation);
            
            offset.localX = dx * cos - dy * sin;
            offset.localY = dx * sin + dy * cos;
            offset.initialBuildingRotation = building.rotation.z;
        }
        
        console.log(`[GroupManager] Offsets пересчитаны для группы ${group.id}`);
    }
    
    /**
     * Проверить, сгруппирован ли объект
     * @param {Underlay|THREE.Mesh} obj
     * @returns {boolean}
     */
    isGrouped(obj) {
        if (obj.groupId) return true;
        if (obj.userData?.groupId) return true;
        return false;
    }
    
    /**
     * Получить все группы
     * @returns {Group[]}
     */
    getAll() {
        return Array.from(this.groups.values());
    }
    
    /**
     * Количество групп
     */
    get count() {
        return this.groups.size;
    }
    
    /**
     * Сериализация для сохранения
     */
    serialize() {
        const data = [];
        
        for (const group of this.groups.values()) {
            data.push({
                id: group.id,
                underlayId: group.underlayId,
                buildingIds: group.buildingIds,
                offsets: group.offsets,
                initialUnderlayRotation: group.initialUnderlayRotation
            });
        }
        
        return data;
    }
    
    /**
     * Восстановление групп
     * @param {Array} dataArray
     * @param {UnderlayManager} underlayManager
     * @param {THREE.Group} buildingsGroup
     */
    deserialize(dataArray, underlayManager, buildingsGroup) {
        this.groups.clear();
        
        for (const data of dataArray) {
            const underlay = underlayManager.get(data.underlayId);
            if (!underlay) continue;
            
            const buildings = [];
            for (const buildingId of data.buildingIds) {
                const building = buildingsGroup.children.find(
                    c => c.userData?.id === buildingId
                );
                if (building) {
                    buildings.push(building);
                }
            }
            
            if (buildings.length > 0) {
                const group = {
                    id: data.id,
                    underlayId: data.underlayId,
                    underlay: underlay,
                    buildingIds: data.buildingIds,
                    buildings: buildings,
                    offsets: data.offsets,
                    initialUnderlayRotation: data.initialUnderlayRotation || underlay.rotation
                };
                
                this.groups.set(data.id, group);
                
                // Помечаем объекты
                underlay.groupId = data.id;
                buildings.forEach(b => {
                    b.userData.groupId = data.id;
                });
                
                // Обновляем счётчик
                const idNum = parseInt(data.id.replace('group-', ''));
                if (idNum > this._idCounter) {
                    this._idCounter = idNum;
                }
            }
        }
        
        console.log(`[GroupManager] Восстановлено ${this.groups.size} групп`);
    }
    
    /**
     * Очистка
     */
    clear() {
        for (const group of this.groups.values()) {
            if (group.underlay) {
                group.underlay.groupId = null;
            }
            group.buildings.forEach(b => {
                if (b.userData) {
                    b.userData.groupId = null;
                }
            });
        }
        
        this.groups.clear();
        console.log('[GroupManager] Очищен');
    }
}

export { GroupManager };
