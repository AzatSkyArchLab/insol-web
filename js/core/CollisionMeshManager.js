/**
 * ============================================
 * CollisionMeshManager.js
 * Управление collision proxy mesh для raycasting
 * ============================================
 * 
 * Объединяет ВСЕ здания сцены + окна + балконы в единый
 * глобальный BufferGeometry для максимально быстрого raycasting.
 * 
 * Аналог "Join Mesh" в Grasshopper/Rhino.
 * 
 * Использует BVH (Bounding Volume Hierarchy) для ускорения
 * raycast в 100-1000x на сложной геометрии.
 */

// Проверяем доступность three-mesh-bvh
const BVH_AVAILABLE = typeof window !== 'undefined' && 
    window.MeshBVHLib && 
    window.MeshBVHLib.MeshBVH;

if (BVH_AVAILABLE) {
    console.log('[CollisionMeshManager] BVH available - raycast will be accelerated');
} else {
    console.log('[CollisionMeshManager] BVH not available - using standard raycast');
}

class CollisionMeshManager {
    constructor() {
        // Кэш collision mesh для каждого здания (для совместимости)
        this.cache = new Map();
        
        // ГЛОБАЛЬНЫЙ collision mesh для всей сцены
        this.globalCollisionMesh = null;
        this.globalVersion = 0;
        
        // Материал для collision mesh (невидимый)
        this.collisionMaterial = new THREE.MeshBasicMaterial({
            visible: false,
            side: THREE.DoubleSide
        });
        
        // Статистика
        this.stats = {
            totalRebuilds: 0,
            totalTriangles: 0,
            totalBuildings: 0,
            totalFeatures: 0,
            bvhEnabled: BVH_AVAILABLE
        };
        
        console.log('[CollisionMeshManager] Создан');
    }
    
    /**
     * Построить ГЛОБАЛЬНЫЙ collision mesh для всей сцены
     * Объединяет ВСЕ здания + ВСЕ features в один mesh
     * @param {THREE.Group} buildingsGroup - группа зданий
     * @returns {THREE.Mesh} глобальный collision mesh
     */
    rebuildGlobal(buildingsGroup) {
        const startTime = performance.now();
        
        // Удаляем старый глобальный mesh
        if (this.globalCollisionMesh) {
            if (this.globalCollisionMesh.geometry) {
                if (this.globalCollisionMesh.geometry.boundsTree) {
                    this.globalCollisionMesh.geometry.boundsTree = null;
                }
                this.globalCollisionMesh.geometry.dispose();
            }
            this.globalCollisionMesh = null;
        }
        
        // Собираем ВСЕ геометрии
        const geometries = [];
        const matrices = [];
        let buildingCount = 0;
        let featureCount = 0;
        
        // Детальная статистика для отладки
        const debugStats = {
            buildings: [],
            featuresFromManager: 0,
            childMeshes: 0
        };
        
        buildingsGroup.children.forEach(child => {
            // Проверяем что это видимый mesh (здание)
            // Исключаем helpers, ghosts, и другие служебные объекты
            const isBuilding = child.visible && 
                child.isMesh && 
                child.geometry &&
                !child.userData.isHelper &&
                !child.userData.isGhost &&
                child.userData.type !== 'ghost' &&
                child.userData.type !== 'measurement';
            
            if (isBuilding) {
                child.updateMatrixWorld(true);
                
                // 1. Геометрия здания
                const posAttr = child.geometry.getAttribute('position');
                const buildingVertices = posAttr ? posAttr.count : 0;
                const hasIndex = !!child.geometry.index;
                const indexCount = hasIndex ? child.geometry.index.count : 0;
                
                console.log(`[CollisionMeshManager] Building ${child.userData.id || child.name}: vertices=${buildingVertices}, indexed=${hasIndex}, indexCount=${indexCount}`);
                
                geometries.push(child.geometry);
                matrices.push(child.matrixWorld.clone());
                buildingCount++;
                
                debugStats.buildings.push({
                    id: child.userData.id || child.name || 'unknown',
                    vertices: buildingVertices,
                    hasFeaturesManager: !!child.userData._featuresManager
                });
                
                // 2. Features из featuresManager
                const featuresManager = child.userData._featuresManager;
                if (featuresManager && featuresManager.featuresGroup) {
                    console.log(`[CollisionMeshManager] Building ${child.userData.id}: featuresGroup has ${featuresManager.featuresGroup.children.length} children`);
                    
                    featuresManager.featuresGroup.traverse((descendant) => {
                        if (descendant.isMesh && descendant.geometry && !descendant.isLine) {
                            const descPosAttr = descendant.geometry.getAttribute('position');
                            const descVertices = descPosAttr ? descPosAttr.count : 0;
                            console.log(`[CollisionMeshManager]   Feature: ${descendant.name || descendant.userData.cellKey || 'unnamed'}, isWindowRecess: ${descendant.userData.isWindowRecess}, isBalcony: ${descendant.userData.isBalcony}, vertices: ${descVertices}`);
                            
                            descendant.updateMatrixWorld(true);
                            geometries.push(descendant.geometry);
                            matrices.push(descendant.matrixWorld.clone());
                            featureCount++;
                            debugStats.featuresFromManager++;
                        }
                    });
                }
                
                // 3. Дочерние меши здания (window recesses, balconies, любые другие)
                child.traverse((descendant) => {
                    if (descendant !== child && descendant.isMesh && descendant.geometry) {
                        const descPosAttr = descendant.geometry.getAttribute('position');
                        const descVertices = descPosAttr ? descPosAttr.count : 0;
                        console.log(`[CollisionMeshManager]   Child mesh: ${descendant.name}, isWindowRecess: ${descendant.userData.isWindowRecess}, isBalcony: ${descendant.userData.isBalcony}, vertices: ${descVertices}`);
                        
                        descendant.updateMatrixWorld(true);
                        geometries.push(descendant.geometry);
                        matrices.push(descendant.matrixWorld.clone());
                        featureCount++;
                        debugStats.childMeshes++;
                    }
                });
            }
        });
        
        console.log('[CollisionMeshManager] Debug stats:', {
            buildings: debugStats.buildings.length,
            featuresFromManager: debugStats.featuresFromManager,
            childMeshes: debugStats.childMeshes,
            totalGeometries: geometries.length,
            buildingDetails: debugStats.buildings
        });
        
        if (geometries.length === 0) {
            console.warn('[CollisionMeshManager] rebuildGlobal: нет геометрии');
            return null;
        }
        
        // Merge всех геометрий
        const mergedGeometry = this._mergeGeometries(geometries, matrices);
        
        if (!mergedGeometry) {
            console.warn('[CollisionMeshManager] rebuildGlobal: merge не удался');
            return null;
        }
        
        // Создаём глобальный collision mesh
        this.globalCollisionMesh = new THREE.Mesh(mergedGeometry, this.collisionMaterial);
        this.globalCollisionMesh.name = 'global-collision-mesh';
        this.globalCollisionMesh.userData.isCollisionMesh = true;
        this.globalCollisionMesh.userData.isGlobalCollisionMesh = true;
        this.globalCollisionMesh.matrixAutoUpdate = false;
        this.globalCollisionMesh.matrixWorld.identity();
        
        // Вычисляем bounding volumes
        mergedGeometry.computeBoundingBox();
        mergedGeometry.computeBoundingSphere();
        
        // Создаём BVH
        if (BVH_AVAILABLE) {
            try {
                const { MeshBVH } = window.MeshBVHLib;
                mergedGeometry.boundsTree = new MeshBVH(mergedGeometry, {
                    maxLeafTris: 5,
                    strategy: 0 // SAH
                });
                this.globalCollisionMesh.userData.hasBVH = true;
            } catch (e) {
                console.warn('[CollisionMeshManager] BVH creation failed:', e.message);
                this.globalCollisionMesh.userData.hasBVH = false;
            }
        }
        
        // Статистика
        const vertexCount = mergedGeometry.getAttribute('position').count;
        const triangleCount = mergedGeometry.index 
            ? mergedGeometry.index.count / 3 
            : vertexCount / 3;
        
        this.stats.totalRebuilds++;
        this.stats.totalTriangles = triangleCount;
        this.stats.totalBuildings = buildingCount;
        this.stats.totalFeatures = featureCount;
        this.globalVersion++;
        
        const elapsed = (performance.now() - startTime).toFixed(1);
        console.log(`[CollisionMeshManager] GLOBAL REBUILD: ${buildingCount} buildings + ${featureCount} features = ${triangleCount} triangles, BVH: ${this.globalCollisionMesh.userData.hasBVH}, ${elapsed}ms`);
        
        return this.globalCollisionMesh;
    }
    
    /**
     * Получить глобальный collision mesh
     * @returns {THREE.Mesh|null}
     */
    getGlobal() {
        return this.globalCollisionMesh;
    }
    
    /**
     * Проверить есть ли глобальный collision mesh
     */
    hasGlobal() {
        return this.globalCollisionMesh !== null;
    }
    
    /**
     * Построить или обновить collision mesh для отдельного здания
     * (для совместимости со старым кодом)
     */
    rebuild(buildingMesh, featuresManager = null) {
        const buildingId = buildingMesh.userData.id;
        const startTime = performance.now();
        
        // Удаляем старый collision mesh
        this.dispose(buildingId);
        
        // Собираем все геометрии для merge
        const geometries = [];
        const matrices = [];
        
        // 1. Геометрия самого здания
        if (buildingMesh.geometry) {
            buildingMesh.updateMatrixWorld(true);
            geometries.push(buildingMesh.geometry);
            matrices.push(buildingMesh.matrixWorld.clone());
        }
        
        // 2. Геометрии из featuresManager (окна, балконы)
        if (featuresManager && featuresManager.featuresGroup) {
            featuresManager.featuresGroup.traverse((child) => {
                if (child.isMesh && child.geometry && !child.isLine) {
                    child.updateMatrixWorld(true);
                    geometries.push(child.geometry);
                    matrices.push(child.matrixWorld.clone());
                }
            });
        }
        
        // 3. Дочерние меши здания
        buildingMesh.traverse((child) => {
            if (child !== buildingMesh && child.isMesh && child.geometry) {
                if (child.userData.isWindowRecess || child.userData.isBalcony) {
                    child.updateMatrixWorld(true);
                    geometries.push(child.geometry);
                    matrices.push(child.matrixWorld.clone());
                }
            }
        });
        
        if (geometries.length === 0) {
            return null;
        }
        
        // Merge
        const mergedGeometry = this._mergeGeometries(geometries, matrices);
        if (!mergedGeometry) return null;
        
        // Создаём collision mesh
        const collisionMesh = new THREE.Mesh(mergedGeometry, this.collisionMaterial);
        collisionMesh.name = `collision-${buildingId}`;
        collisionMesh.userData.isCollisionMesh = true;
        collisionMesh.userData.sourceBuildingId = buildingId;
        
        // Bounding volumes
        mergedGeometry.computeBoundingBox();
        mergedGeometry.computeBoundingSphere();
        
        // BVH
        if (BVH_AVAILABLE) {
            try {
                const { MeshBVH } = window.MeshBVHLib;
                mergedGeometry.boundsTree = new MeshBVH(mergedGeometry, {
                    maxLeafTris: 5,
                    strategy: 0
                });
                collisionMesh.userData.hasBVH = true;
            } catch (e) {
                collisionMesh.userData.hasBVH = false;
            }
        }
        
        // Кэшируем
        this.cache.set(buildingId, {
            mesh: collisionMesh,
            version: Date.now()
        });
        
        // Сохраняем ссылку в userData здания
        buildingMesh.userData.collisionMesh = collisionMesh;
        
        const triangleCount = mergedGeometry.index 
            ? mergedGeometry.index.count / 3 
            : mergedGeometry.getAttribute('position').count / 3;
        
        const elapsed = (performance.now() - startTime).toFixed(1);
        console.log(`[CollisionMeshManager] Rebuild ${buildingId}: ${triangleCount} triangles, BVH: ${collisionMesh.userData.hasBVH}, ${elapsed}ms`);
        
        return collisionMesh;
    }
    
    /**
     * Получить collision mesh для здания
     */
    get(buildingOrId) {
        const id = typeof buildingOrId === 'string' 
            ? buildingOrId 
            : buildingOrId?.userData?.id;
        
        const cached = this.cache.get(id);
        return cached ? cached.mesh : null;
    }
    
    /**
     * Проверить есть ли collision mesh
     */
    has(buildingOrId) {
        const id = typeof buildingOrId === 'string' 
            ? buildingOrId 
            : buildingOrId?.userData?.id;
        return this.cache.has(id);
    }
    
    /**
     * Удалить collision mesh
     */
    dispose(buildingOrId) {
        const id = typeof buildingOrId === 'string' 
            ? buildingOrId 
            : buildingOrId?.userData?.id;
        
        const cached = this.cache.get(id);
        if (cached) {
            if (cached.mesh.geometry) {
                if (cached.mesh.geometry.boundsTree) {
                    cached.mesh.geometry.boundsTree = null;
                }
                cached.mesh.geometry.dispose();
            }
            this.cache.delete(id);
        }
    }
    
    /**
     * Очистить весь кэш
     */
    clear() {
        for (const [id, cached] of this.cache) {
            if (cached.mesh.geometry) {
                if (cached.mesh.geometry.boundsTree) {
                    cached.mesh.geometry.boundsTree = null;
                }
                cached.mesh.geometry.dispose();
            }
        }
        this.cache.clear();
        
        // Очищаем глобальный mesh
        if (this.globalCollisionMesh) {
            if (this.globalCollisionMesh.geometry) {
                if (this.globalCollisionMesh.geometry.boundsTree) {
                    this.globalCollisionMesh.geometry.boundsTree = null;
                }
                this.globalCollisionMesh.geometry.dispose();
            }
            this.globalCollisionMesh = null;
        }
        
        console.log('[CollisionMeshManager] Кэш очищен');
    }
    
    /**
     * Merge нескольких BufferGeometry с применением матриц
     * Корректно обрабатывает смешанные indexed/non-indexed геометрии
     * @private
     */
    _mergeGeometries(geometries, matrices) {
        if (geometries.length === 0) return null;
        
        // Подсчитываем общее количество вершин и треугольников
        let totalVertices = 0;
        let totalTriangles = 0;
        
        const geoInfo = [];
        
        for (let i = 0; i < geometries.length; i++) {
            const geom = geometries[i];
            const pos = geom.getAttribute('position');
            if (!pos) continue;
            
            const vertexCount = pos.count;
            let triangleCount;
            
            if (geom.index) {
                triangleCount = geom.index.count / 3;
            } else {
                // Non-indexed: каждые 3 вершины = 1 треугольник
                triangleCount = vertexCount / 3;
            }
            
            geoInfo.push({
                geom,
                matrix: matrices[i],
                vertexCount,
                triangleCount,
                hasIndex: !!geom.index
            });
            
            totalVertices += vertexCount;
            totalTriangles += triangleCount;
        }
        
        if (totalVertices === 0) return null;
        
        // Создаём буферы
        // Для merged всегда используем indexed geometry для оптимизации raycast
        const mergedPositions = new Float32Array(totalVertices * 3);
        const mergedIndices = new Uint32Array(totalTriangles * 3);
        
        let vertexOffset = 0;
        let indexOffset = 0;
        
        const tempVertex = new THREE.Vector3();
        
        for (const info of geoInfo) {
            const { geom, matrix, vertexCount, hasIndex } = info;
            const pos = geom.getAttribute('position');
            
            // Копируем и трансформируем вершины
            for (let j = 0; j < vertexCount; j++) {
                tempVertex.set(
                    pos.getX(j),
                    pos.getY(j),
                    pos.getZ(j)
                );
                
                tempVertex.applyMatrix4(matrix);
                
                const idx = (vertexOffset + j) * 3;
                mergedPositions[idx] = tempVertex.x;
                mergedPositions[idx + 1] = tempVertex.y;
                mergedPositions[idx + 2] = tempVertex.z;
            }
            
            // Копируем/создаём индексы
            if (hasIndex) {
                // Indexed geometry - копируем индексы со смещением
                const indices = geom.index.array;
                for (let j = 0; j < indices.length; j++) {
                    mergedIndices[indexOffset + j] = indices[j] + vertexOffset;
                }
                indexOffset += geom.index.count;
            } else {
                // Non-indexed geometry - создаём последовательные индексы
                for (let j = 0; j < vertexCount; j++) {
                    mergedIndices[indexOffset + j] = vertexOffset + j;
                }
                indexOffset += vertexCount;
            }
            
            vertexOffset += vertexCount;
        }
        
        // Создаём merged geometry
        const merged = new THREE.BufferGeometry();
        merged.setAttribute('position', new THREE.BufferAttribute(mergedPositions, 3));
        merged.setIndex(new THREE.BufferAttribute(mergedIndices, 1));
        
        return merged;
    }
}

// Singleton instance
const collisionMeshManager = new CollisionMeshManager();

export { CollisionMeshManager, collisionMeshManager };
window.CollisionMeshManager = CollisionMeshManager;
window.collisionMeshManager = collisionMeshManager;