/**
 * ============================================
 * BuildingMesh.js
 * Создание 3D-мешей зданий
 * ============================================
 */

class BuildingMesh {
    constructor(coordinates) {
        this.coordinates = coordinates;
        
        this.defaultMaterial = new THREE.MeshLambertMaterial({
            color: 0x4a90d9,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide // Видно с обеих сторон
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
        
        // Очистка геометрии
        points = this._cleanPolygon(points);
        
        if (points.length < 3) {
            return null;
        }
        
        // Проверяем площадь — если слишком маленькая, пропускаем
        const area = this._signedArea(points);
        if (Math.abs(area) < 1) { // меньше 1 кв.м
            return null;
        }
        
        // Обеспечиваем правильную ориентацию (против часовой стрелки)
        // Для Three.js/earcut нужна положительная площадь (CCW)
        if (area < 0) {
            points.reverse();
        }
        
        try {
            const geometry = this._createBuildingGeometry(points, height);
            
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
            console.warn(`[BuildingMesh] Ошибка здания ${building.id}:`, e.message);
            return null;
        }
    }
    
    /**
     * Очистка полигона от проблемных точек
     */
    _cleanPolygon(points) {
        if (points.length < 3) return points;
        
        let result = [];
        
        // 1. Убираем дубликат последней точки (замыкание)
        const first = points[0];
        const last = points[points.length - 1];
        if (this._distance(first, last) < 0.1) {
            points = points.slice(0, -1);
        }
        
        // 2. Убираем подряд идущие дубликаты
        for (let i = 0; i < points.length; i++) {
            const curr = points[i];
            const prev = result.length > 0 ? result[result.length - 1] : null;
            
            if (!prev || this._distance(curr, prev) > 0.1) {
                result.push(curr);
            }
        }
        
        // 3. Убираем коллинеарные точки (точки на одной линии)
        result = this._removeCollinearPoints(result);
        
        return result;
    }
    
    /**
     * Убираем точки, лежащие на одной линии с соседями
     */
    _removeCollinearPoints(points) {
        if (points.length < 3) return points;
        
        const result = [];
        const n = points.length;
        
        for (let i = 0; i < n; i++) {
            const prev = points[(i - 1 + n) % n];
            const curr = points[i];
            const next = points[(i + 1) % n];
            
            // Проверяем коллинеарность через cross product
            const cross = (curr.x - prev.x) * (next.y - prev.y) - 
                          (curr.y - prev.y) * (next.x - prev.x);
            
            if (Math.abs(cross) > 0.01) { // Не коллинеарны
                result.push(curr);
            }
        }
        
        return result;
    }
    
    /**
     * Расстояние между точками
     */
    _distance(p1, p2) {
        return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
    }
    
    /**
     * Знаковая площадь полигона (Shoelace formula)
     * Положительная = против часовой стрелки (CCW)
     * Отрицательная = по часовой стрелке (CW)
     */
    _signedArea(points) {
        let area = 0;
        const n = points.length;
        
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        
        return area / 2;
    }
    
    /**
     * Создание геометрии здания
     */
    _createBuildingGeometry(points, height) {
        const n = points.length;
        
        // Плоский массив для earcut
        const flatCoords = [];
        for (const p of points) {
            flatCoords.push(p.x, p.y);
        }
        
        // Триангуляция
        const triangles = earcut(flatCoords);
        
        if (triangles.length < 3) {
            return null;
        }
        
        // Проверяем что триангуляция валидна
        if (triangles.length % 3 !== 0) {
            return null;
        }
        
        const vertices = [];
        const indices = [];
        
        // === ВЕРШИНЫ ===
        
        // Нижние вершины (индексы 0 .. n-1)
        for (const p of points) {
            vertices.push(p.x, p.y, 0);
        }
        
        // Верхние вершины (индексы n .. 2n-1)
        for (const p of points) {
            vertices.push(p.x, p.y, height);
        }
        
        // === ИНДЕКСЫ ГРАНЕЙ ===
        
        // Нижняя грань (нормаль вниз, меняем порядок)
        for (let i = 0; i < triangles.length; i += 3) {
            indices.push(triangles[i], triangles[i + 2], triangles[i + 1]);
        }
        
        // Верхняя грань (нормаль вверх)
        for (let i = 0; i < triangles.length; i += 3) {
            indices.push(
                triangles[i] + n,
                triangles[i + 1] + n,
                triangles[i + 2] + n
            );
        }
        
        // Боковые грани
        // Добавляем отдельные вершины для каждой стены (для корректных нормалей)
        const wallBaseIndex = vertices.length / 3;
        
        for (let i = 0; i < n; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % n];
            
            const idx = wallBaseIndex + i * 4;
            
            // 4 вершины стены: низ-слева, низ-справа, верх-справа, верх-слева
            vertices.push(p1.x, p1.y, 0);       // idx + 0
            vertices.push(p2.x, p2.y, 0);       // idx + 1
            vertices.push(p2.x, p2.y, height);  // idx + 2
            vertices.push(p1.x, p1.y, height);  // idx + 3
            
            // Два треугольника (CCW для внешней нормали)
            indices.push(idx + 0, idx + 1, idx + 2);
            indices.push(idx + 0, idx + 2, idx + 3);
        }
        
        // Создаём геометрию
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        
        return geometry;
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
        
        console.log(`[BuildingMesh] Создано: ${meshes.length}, пропущено: ${errors}`);
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