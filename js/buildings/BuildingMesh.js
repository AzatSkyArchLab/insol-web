/**
 * ============================================
 * BuildingMesh.js
 * Создание 3D-мешей зданий (с earcut триангуляцией)
 * ============================================
 */

class BuildingMesh {
    constructor(coordinates) {
        this.coordinates = coordinates;
        
        this.defaultMaterial = new THREE.MeshLambertMaterial({
            color: 0x4a90d9,
            transparent: true,
            opacity: 0.9
        });
        
        console.log('[BuildingMesh] Создан');
    }
    
    createMesh(building) {
        if (!building.coordinates || building.coordinates.length < 4) {
            return null;
        }
        
        const height = building.properties.height || 9;
        
        // Конвертируем координаты в метры
        let points = building.coordinates.map(coord => {
            const meters = this.coordinates.wgs84ToMeters(coord[1], coord[0]);
            return { x: meters.x, y: meters.y };
        });
        
        // Убираем дубликат последней точки
        if (points.length > 1) {
            const first = points[0];
            const last = points[points.length - 1];
            const dist = Math.sqrt((first.x - last.x) ** 2 + (first.y - last.y) ** 2);
            if (dist < 0.1) {
                points.pop();
            }
        }
        
        if (points.length < 3) {
            return null;
        }
        
        // Убираем дублирующиеся подряд точки
        points = this._removeDuplicatePoints(points);
        
        if (points.length < 3) {
            return null;
        }
        
        try {
            // Создаём геометрию вручную через earcut
            const geometry = this._createExtrudedGeometry(points, height);
            
            if (!geometry) {
                return null;
            }
            
            const mesh = new THREE.Mesh(geometry, this.defaultMaterial.clone());
            
            mesh.userData = {
                id: building.id,
                type: 'building',
                properties: building.properties
            };
            
            return mesh;
            
        } catch (e) {
            return null;
        }
    }
    
    /**
     * Создаём экструдированную геометрию вручную
     */
    _createExtrudedGeometry(points, height) {
        // Плоский массив координат для earcut
        const flatCoords = [];
        for (const p of points) {
            flatCoords.push(p.x, p.y);
        }
        
        // Триангуляция основания
        const triangles = earcut(flatCoords);
        
        if (triangles.length < 3) {
            return null;
        }
        
        const vertices = [];
        const indices = [];
        
        const n = points.length;
        
        // Нижняя грань (z = 0)
        for (const p of points) {
            vertices.push(p.x, p.y, 0);
        }
        
        // Верхняя грань (z = height)
        for (const p of points) {
            vertices.push(p.x, p.y, height);
        }
        
        // Индексы нижней грани (перевёрнутые для правильной нормали)
        for (let i = 0; i < triangles.length; i += 3) {
            indices.push(triangles[i], triangles[i + 2], triangles[i + 1]);
        }
        
        // Индексы верхней грани
        for (let i = 0; i < triangles.length; i += 3) {
            indices.push(triangles[i] + n, triangles[i + 1] + n, triangles[i + 2] + n);
        }
        
        // Боковые грани
        const wallStartIndex = vertices.length / 3;
        
        for (let i = 0; i < n; i++) {
            const i1 = i;
            const i2 = (i + 1) % n;
            
            const p1 = points[i1];
            const p2 = points[i2];
            
            // 4 вершины стены
            const baseIdx = wallStartIndex + i * 4;
            
            vertices.push(p1.x, p1.y, 0);      // 0: низ-лево
            vertices.push(p2.x, p2.y, 0);      // 1: низ-право
            vertices.push(p2.x, p2.y, height); // 2: верх-право
            vertices.push(p1.x, p1.y, height); // 3: верх-лево
            
            // Два треугольника стены
            indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
            indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
        }
        
        // Создаём BufferGeometry
        const geometry = new THREE.BufferGeometry();
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        
        return geometry;
    }
    
    /**
     * Убираем дублирующиеся подряд точки
     */
    _removeDuplicatePoints(points) {
        const result = [points[0]];
        
        for (let i = 1; i < points.length; i++) {
            const prev = result[result.length - 1];
            const curr = points[i];
            const dist = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2);
            
            if (dist > 0.1) {
                result.push(curr);
            }
        }
        
        return result;
    }
    
    createMeshes(buildings) {
        const meshes = [];
        let errors = 0;
        
        for (const building of buildings) {
            const mesh = this.createMesh(building);
            if (mesh) {
                meshes.push(mesh);
            } else {
                errors++;
            }
        }
        
        if (errors > 0) {
            console.log(`[BuildingMesh] Пропущено зданий: ${errors}`);
        }
        
        console.log(`[BuildingMesh] Создано мешей: ${meshes.length}`);
        return meshes;
    }
    
    highlight(mesh) {
        if (mesh && mesh.material) {
            mesh.material.color.setHex(0xff6b6b);
        }
    }
    
    unhighlight(mesh) {
        if (mesh && mesh.material) {
            mesh.material.color.setHex(0x4a90d9);
        }
    }
}

export { BuildingMesh };
window.BuildingMesh = BuildingMesh;