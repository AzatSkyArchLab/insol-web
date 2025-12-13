/**
 * ============================================
 * ProjectExporter.js
 * Экспорт проекта в GeoJSON и OBJ
 * ============================================
 */

class ProjectExporter {
    constructor(sceneManager, coords, options = {}) {
        this.sceneManager = sceneManager;
        this.coords = coords;
        this.mapCenter = options.mapCenter || null;  // {lat, lng}
        this.mapZoom = options.mapZoom || 17;
        
        console.log('[ProjectExporter] Создан');
    }
    
    /**
     * Установить центр карты (для сохранения в GeoJSON)
     */
    setMapCenter(lat, lng, zoom) {
        this.mapCenter = { lat, lng };
        this.mapZoom = zoom;
    }
    
    // ========================================
    // GeoJSON Export
    // ========================================
    
    /**
     * Экспорт в GeoJSON
     * @returns {Object} GeoJSON FeatureCollection
     */
    exportToGeoJSON() {
        const buildingsGroup = this.sceneManager.getBuildingsGroup();
        const features = [];
        
        if (!this.coords) {
            console.error('[ProjectExporter] Coordinates не инициализирован');
            return null;
        }
        
        console.log(`[ProjectExporter] Всего объектов в группе: ${buildingsGroup.children.length}`);
        
        buildingsGroup.children.forEach((mesh, index) => {
            console.log(`[ProjectExporter] Объект ${index}: type=${mesh.userData?.type}, id=${mesh.userData?.id}`);
            
            // Принимаем здания с type='building' ИЛИ без type (для совместимости)
            const isBuilding = mesh.userData?.type === 'building' || 
                              (mesh.geometry && mesh.geometry.type === 'ExtrudeGeometry');
            
            if (!isBuilding) {
                console.log(`[ProjectExporter] Пропуск объекта ${index}: не здание`);
                return;
            }
            
            try {
                const feature = this._meshToGeoJSONFeature(mesh);
                if (feature) {
                    features.push(feature);
                    console.log(`[ProjectExporter] Добавлено здание ${mesh.userData?.id}`);
                } else {
                    console.warn(`[ProjectExporter] _meshToGeoJSONFeature вернул null для ${mesh.userData?.id}`);
                }
            } catch (e) {
                console.warn(`[ProjectExporter] Ошибка конвертации здания ${mesh.userData?.id}:`, e);
            }
        });
        
        // Стандартный GeoJSON формат (RFC 7946)
        // Координаты всегда в WGS84, порядок [longitude, latitude]
        const geojson = {
            type: 'FeatureCollection',
            name: 'insol_web_export',
            crs: {
                type: 'name', 
                properties: {
                    name: 'urn:ogc:def:crs:EPSG::4326'
                }
            },
            features: features
        };
        
        console.log(`[ProjectExporter] GeoJSON: ${features.length} зданий`);
        return geojson;
    }
    
    /**
     * Конвертировать mesh в GeoJSON Feature
     */
    _meshToGeoJSONFeature(mesh) {
        // Получаем базовые точки в мировых координатах
        let worldPoints = this._getWorldBasePoints(mesh);
        
        if (!worldPoints || worldPoints.length < 3) {
            console.warn(`[ProjectExporter] Не удалось получить точки для ${mesh.userData?.id}`);
            return null;
        }
        
        // Конвертируем в WGS84
        const wgs84Coords = worldPoints.map(p => {
            // metersToWgs84 возвращает {lat, lon}
            const latLon = this.coords.metersToWgs84(p.x, p.y);
            // Округляем до 7 знаков (точность ~1см)
            return [
                parseFloat(latLon.lon.toFixed(7)),
                parseFloat(latLon.lat.toFixed(7))
            ];
        });
        
        // Отладка: выводим первую точку
        if (wgs84Coords.length > 0) {
            console.log(`[ProjectExporter] Здание ${mesh.userData?.id}: первая точка [${wgs84Coords[0][0]}, ${wgs84Coords[0][1]}]`);
        }
        
        // Замыкаем полигон
        if (wgs84Coords.length > 0) {
            const first = wgs84Coords[0];
            const last = wgs84Coords[wgs84Coords.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
                wgs84Coords.push([...first]);
            }
        }
        
        // Свойства
        const props = mesh.userData.properties || {};
        
        return {
            type: 'Feature',
            properties: {
                id: mesh.userData.id || null,
                height: props.height || mesh.userData.height || 9,
                isResidential: props.isResidential || false,
                source: props.source || 'drawn',
                floors: props.floors || null,
                name: props.name || null,
                // Дополнительные свойства из OSM
                ...this._extractOSMProperties(props)
            },
            geometry: {
                type: 'Polygon',
                coordinates: [wgs84Coords]
            }
        };
    }
    
    /**
     * Получить базовые точки в мировых координатах
     */
    _getWorldBasePoints(mesh) {
        const pos = mesh.position;
        const rot = mesh.rotation.z || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        
        let localPoints = null;
        let needsOrdering = false;
        
        // 0. Из userData.basePoints (нарисованные здания) - порядок уже правильный
        if (mesh.userData.basePoints && mesh.userData.basePoints.length >= 3) {
            localPoints = mesh.userData.basePoints.map(p => ({ x: p.x, y: p.y }));
            console.log(`[ProjectExporter] Точки из basePoints: ${localPoints.length}`);
        }
        
        // 1. Из geometry parameters (Shape) - порядок уже правильный
        if (!localPoints) {
            const params = mesh.geometry?.parameters;
            if (params && params.shapes) {
                const shape = params.shapes;
                const shapePoints = shape.getPoints ? shape.getPoints() : null;
                if (shapePoints && shapePoints.length >= 3) {
                    localPoints = shapePoints.map(p => ({ x: p.x, y: p.y }));
                    console.log(`[ProjectExporter] Точки из Shape: ${localPoints.length}`);
                }
            }
        }
        
        // 2. Из geometry attributes (нижний контур) - нужна сортировка
        if (!localPoints) {
            const position = mesh.geometry?.getAttribute('position');
            if (position) {
                let minZ = Infinity;
                for (let i = 0; i < position.count; i++) {
                    const z = position.getZ(i);
                    if (z < minZ) minZ = z;
                }
                
                const pointsMap = new Map();
                for (let i = 0; i < position.count; i++) {
                    const z = position.getZ(i);
                    if (Math.abs(z - minZ) < 0.5) {
                        const x = parseFloat(position.getX(i).toFixed(2));
                        const y = parseFloat(position.getY(i).toFixed(2));
                        const key = `${x},${y}`;
                        if (!pointsMap.has(key)) {
                            pointsMap.set(key, { x, y });
                        }
                    }
                }
                
                localPoints = Array.from(pointsMap.values());
                needsOrdering = true; // Только для этого случая нужна сортировка
                console.log(`[ProjectExporter] Точки из geometry: ${localPoints.length}`);
            }
        }
        
        if (!localPoints || localPoints.length < 3) {
            console.warn(`[ProjectExporter] Недостаточно точек: ${localPoints?.length || 0}`);
            return null;
        }
        
        // Сортируем по углу ТОЛЬКО если точки извлечены из geometry (порядок потерян)
        // Для basePoints и Shape порядок уже правильный
        if (needsOrdering) {
            const cx = localPoints.reduce((s, p) => s + p.x, 0) / localPoints.length;
            const cy = localPoints.reduce((s, p) => s + p.y, 0) / localPoints.length;
            localPoints.sort((a, b) => {
                return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
            });
        }
        
        // Трансформируем в мировые координаты
        return localPoints.map(p => ({
            x: p.x * cos - p.y * sin + pos.x,
            y: p.x * sin + p.y * cos + pos.y
        }));
    }
    
    /**
     * Извлечь OSM свойства
     */
    _extractOSMProperties(props) {
        const osmProps = {};
        const osmKeys = ['building', 'building:levels', 'roof:shape', 'addr:street', 'addr:housenumber'];
        
        osmKeys.forEach(key => {
            if (props[key] !== undefined) {
                osmProps[key] = props[key];
            }
        });
        
        return osmProps;
    }
    
    /**
     * Скачать GeoJSON файл
     */
    downloadGeoJSON(filename = 'project.geojson') {
        const geojson = this.exportToGeoJSON();
        
        if (!geojson) {
            alert('Ошибка экспорта GeoJSON: координатная система не инициализирована');
            return;
        }
        
        if (geojson.features.length === 0) {
            alert('Нет зданий для экспорта');
            return;
        }
        
        const json = JSON.stringify(geojson, null, 2);
        this._downloadFile(json, filename, 'application/geo+json');
    }
    
    // ========================================
    // OBJ Export
    // ========================================
    
    /**
     * Экспорт в OBJ
     * @param {Object} options - Опции экспорта
     * @returns {Object} {obj: string, mtl: string, materials: Map}
     */
    exportToOBJ(options = {}) {
        const includeMap = options.includeMap !== false;
        
        let objContent = '# Insol Web OBJ Export\n';
        objContent += `# Exported: ${new Date().toISOString()}\n`;
        objContent += `# Units: meters\n\n`;
        
        let mtlContent = '# Insol Web MTL\n\n';
        
        const buildingsGroup = this.sceneManager.getBuildingsGroup();
        
        // Глобальные счётчики для OBJ (начинаются с 1)
        let vOffset = 1;   // вершины
        let vtOffset = 1;  // UV координаты
        let vnOffset = 1;  // нормали
        
        const materials = new Map();
        
        // Экспортируем здания
        buildingsGroup.children.forEach((mesh, index) => {
            if (mesh.userData.type !== 'building') return;
            
            const name = mesh.userData.id || `building_${index}`;
            const materialName = this._getMaterialName(mesh, materials);
            
            const result = this._meshToOBJ(mesh, name, materialName, vOffset, vtOffset, vnOffset);
            objContent += result.obj;
            vOffset = result.vOffset;
            vtOffset = result.vtOffset;
            vnOffset = result.vnOffset;
        });
        
        // Экспортируем карту OSM
        if (includeMap) {
            const mapData = this._exportMapTiles(vOffset, vtOffset, vnOffset, materials);
            if (mapData) {
                objContent += mapData.obj;
            }
        }
        
        // Генерируем MTL
        mtlContent += this._generateMTL(materials);
        
        console.log(`[ProjectExporter] OBJ: ${buildingsGroup.children.length} объектов`);
        
        return { obj: objContent, mtl: mtlContent, materials: materials };
    }
    
    /**
     * Экспорт тайлов карты
     */
    _exportMapTiles(vOffset, vtOffset, vnOffset, materials) {
        // Получаем ground группу напрямую из sceneManager
        const groundGroup = this.sceneManager.ground;
        
        if (!groundGroup) {
            console.warn('[ProjectExporter] Ground группа не найдена');
            return null;
        }
        
        // Собираем все тайлы с текстурами
        const tiles = [];
        groundGroup.children.forEach(child => {
            if (child.material && child.material.map) {
                tiles.push(child);
            }
        });
        
        if (tiles.length === 0) {
            console.warn('[ProjectExporter] Тайлы карты не найдены');
            return null;
        }
        
        let objContent = '';
        
        // Экспортируем каждый тайл
        tiles.forEach((tile, index) => {
            const tileName = `map_tile_${index}`;
            const materialName = `map_tile_${index}_mat`;
            
            const result = this._meshToOBJWithUV(tile, tileName, materialName, vOffset, vtOffset, vnOffset);
            objContent += result.obj;
            vOffset = result.vOffset;
            vtOffset = result.vtOffset;
            vnOffset = result.vnOffset;
            
            // Материал с текстурой
            materials.set(materialName, { 
                color: [1, 1, 1], 
                map: `map_tile_${index}.png`,
                texture: tile.material.map
            });
        });
        
        console.log(`[ProjectExporter] Карта: ${tiles.length} тайлов`);
        
        return { obj: objContent };
    }
    
    /**
     * Конвертировать mesh в OBJ формат
     */
    _meshToOBJ(mesh, name, materialName, vOffset, vtOffset, vnOffset) {
        let obj = `\n# Object: ${name}\n`;
        obj += `o ${name}\n`;
        obj += `usemtl ${materialName}\n`;
        
        mesh.updateMatrixWorld(true);
        
        const geometry = mesh.geometry;
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        const index = geometry.getIndex();
        
        const startV = vOffset;
        const startVn = vnOffset;
        
        // Вершины
        for (let i = 0; i < position.count; i++) {
            const vertex = new THREE.Vector3(
                position.getX(i),
                position.getY(i),
                position.getZ(i)
            );
            vertex.applyMatrix4(mesh.matrixWorld);
            // Z-up to Y-up: X→X, Z→Y, Y→-Z
            obj += `v ${vertex.x.toFixed(4)} ${vertex.z.toFixed(4)} ${-vertex.y.toFixed(4)}\n`;
        }
        
        // Нормали
        if (normal) {
            for (let i = 0; i < normal.count; i++) {
                const n = new THREE.Vector3(
                    normal.getX(i),
                    normal.getY(i),
                    normal.getZ(i)
                );
                n.applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld));
                obj += `vn ${n.x.toFixed(4)} ${n.z.toFixed(4)} ${-n.y.toFixed(4)}\n`;
            }
        }
        
        // Грани
        if (index) {
            for (let i = 0; i < index.count; i += 3) {
                const a = index.getX(i) + startV;
                const b = index.getX(i + 1) + startV;
                const c = index.getX(i + 2) + startV;
                
                if (normal) {
                    const na = index.getX(i) + startVn;
                    const nb = index.getX(i + 1) + startVn;
                    const nc = index.getX(i + 2) + startVn;
                    obj += `f ${a}//${na} ${b}//${nb} ${c}//${nc}\n`;
                } else {
                    obj += `f ${a} ${b} ${c}\n`;
                }
            }
        } else {
            for (let i = 0; i < position.count; i += 3) {
                const a = i + startV;
                const b = i + 1 + startV;
                const c = i + 2 + startV;
                
                if (normal) {
                    const na = i + startVn;
                    const nb = i + 1 + startVn;
                    const nc = i + 2 + startVn;
                    obj += `f ${a}//${na} ${b}//${nb} ${c}//${nc}\n`;
                } else {
                    obj += `f ${a} ${b} ${c}\n`;
                }
            }
        }
        
        return {
            obj: obj,
            vOffset: vOffset + position.count,
            vtOffset: vtOffset,  // не менялся
            vnOffset: normal ? vnOffset + normal.count : vnOffset
        };
    }
    
    /**
     * Конвертировать mesh в OBJ с UV координатами
     */
    _meshToOBJWithUV(mesh, name, materialName, vOffset, vtOffset, vnOffset) {
        let obj = `\n# Object: ${name}\n`;
        obj += `o ${name}\n`;
        obj += `usemtl ${materialName}\n`;
        
        mesh.updateMatrixWorld(true);
        
        const geometry = mesh.geometry;
        const position = geometry.getAttribute('position');
        const uv = geometry.getAttribute('uv');
        const normal = geometry.getAttribute('normal');
        const index = geometry.getIndex();
        
        const startV = vOffset;
        const startVt = vtOffset;
        const startVn = vnOffset;
        
        // Вершины
        for (let i = 0; i < position.count; i++) {
            const vertex = new THREE.Vector3(
                position.getX(i),
                position.getY(i),
                position.getZ(i)
            );
            vertex.applyMatrix4(mesh.matrixWorld);
            obj += `v ${vertex.x.toFixed(4)} ${vertex.z.toFixed(4)} ${-vertex.y.toFixed(4)}\n`;
        }
        
        // UV координаты
        if (uv) {
            for (let i = 0; i < uv.count; i++) {
                obj += `vt ${uv.getX(i).toFixed(4)} ${uv.getY(i).toFixed(4)}\n`;
            }
        }
        
        // Нормали
        if (normal) {
            for (let i = 0; i < normal.count; i++) {
                const n = new THREE.Vector3(
                    normal.getX(i),
                    normal.getY(i),
                    normal.getZ(i)
                );
                n.applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld));
                obj += `vn ${n.x.toFixed(4)} ${n.z.toFixed(4)} ${-n.y.toFixed(4)}\n`;
            }
        }
        
        // Грани с UV
        if (index) {
            for (let i = 0; i < index.count; i += 3) {
                const idx0 = index.getX(i);
                const idx1 = index.getX(i + 1);
                const idx2 = index.getX(i + 2);
                
                const v0 = idx0 + startV;
                const v1 = idx1 + startV;
                const v2 = idx2 + startV;
                
                if (uv && normal) {
                    const vt0 = idx0 + startVt;
                    const vt1 = idx1 + startVt;
                    const vt2 = idx2 + startVt;
                    const vn0 = idx0 + startVn;
                    const vn1 = idx1 + startVn;
                    const vn2 = idx2 + startVn;
                    obj += `f ${v0}/${vt0}/${vn0} ${v1}/${vt1}/${vn1} ${v2}/${vt2}/${vn2}\n`;
                } else if (uv) {
                    const vt0 = idx0 + startVt;
                    const vt1 = idx1 + startVt;
                    const vt2 = idx2 + startVt;
                    obj += `f ${v0}/${vt0} ${v1}/${vt1} ${v2}/${vt2}\n`;
                } else if (normal) {
                    const vn0 = idx0 + startVn;
                    const vn1 = idx1 + startVn;
                    const vn2 = idx2 + startVn;
                    obj += `f ${v0}//${vn0} ${v1}//${vn1} ${v2}//${vn2}\n`;
                } else {
                    obj += `f ${v0} ${v1} ${v2}\n`;
                }
            }
        } else {
            for (let i = 0; i < position.count; i += 3) {
                const v0 = i + startV;
                const v1 = i + 1 + startV;
                const v2 = i + 2 + startV;
                
                if (uv && normal) {
                    const vt0 = i + startVt;
                    const vt1 = i + 1 + startVt;
                    const vt2 = i + 2 + startVt;
                    const vn0 = i + startVn;
                    const vn1 = i + 1 + startVn;
                    const vn2 = i + 2 + startVn;
                    obj += `f ${v0}/${vt0}/${vn0} ${v1}/${vt1}/${vn1} ${v2}/${vt2}/${vn2}\n`;
                } else if (uv) {
                    const vt0 = i + startVt;
                    const vt1 = i + 1 + startVt;
                    const vt2 = i + 2 + startVt;
                    obj += `f ${v0}/${vt0} ${v1}/${vt1} ${v2}/${vt2}\n`;
                } else if (normal) {
                    const vn0 = i + startVn;
                    const vn1 = i + 1 + startVn;
                    const vn2 = i + 2 + startVn;
                    obj += `f ${v0}//${vn0} ${v1}//${vn1} ${v2}//${vn2}\n`;
                } else {
                    obj += `f ${v0} ${v1} ${v2}\n`;
                }
            }
        }
        
        return {
            obj: obj,
            vOffset: vOffset + position.count,
            vtOffset: uv ? vtOffset + uv.count : vtOffset,
            vnOffset: normal ? vnOffset + normal.count : vnOffset
        };
    }
    
    /**
     * Получить имя материала для mesh
     */
    _getMaterialName(mesh, materials) {
        const props = mesh.userData.properties || {};
        const isResidential = props.isResidential;
        
        let materialName;
        let color;
        
        if (isResidential) {
            materialName = 'residential';
            color = [0.42, 0.53, 0.65];  // Синий
        } else {
            materialName = 'non_residential';
            color = [0.6, 0.6, 0.6];  // Серый
        }
        
        if (!materials.has(materialName)) {
            materials.set(materialName, { color: color });
        }
        
        return materialName;
    }
    
    /**
     * Генерировать MTL файл
     */
    _generateMTL(materials) {
        let mtl = '';
        
        materials.forEach((props, name) => {
            mtl += `newmtl ${name}\n`;
            mtl += `Ka 0.2 0.2 0.2\n`;  // Ambient
            mtl += `Kd ${props.color[0].toFixed(3)} ${props.color[1].toFixed(3)} ${props.color[2].toFixed(3)}\n`;  // Diffuse
            mtl += `Ks 0.1 0.1 0.1\n`;  // Specular
            mtl += `Ns 10\n`;  // Shininess
            mtl += `d 1.0\n`;  // Opacity
            
            if (props.map) {
                mtl += `map_Kd ${props.map}\n`;
            }
            
            mtl += '\n';
        });
        
        return mtl;
    }
    
    /**
     * Извлечь текстуру в Data URL
     */
    _textureToDataURL(texture) {
        if (!texture || !texture.image) {
            console.warn('[ProjectExporter] Текстура не имеет image');
            return null;
        }
        
        try {
            const img = texture.image;
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = img.width || img.naturalWidth || 256;
            canvas.height = img.height || img.naturalHeight || 256;
            
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Это может вызвать SecurityError если текстура с другого домена без CORS
            return canvas.toDataURL('image/png');
        } catch (e) {
            // CORS ошибка - текстура загружена без правильных заголовков
            console.warn('[ProjectExporter] Не удалось извлечь текстуру (CORS?):', e.message);
            return null;
        }
    }
    
    /**
     * Скачать OBJ файл (с MTL и текстурами в ZIP)
     */
    async downloadOBJ(filename = 'project') {
        const { obj, mtl, materials } = this.exportToOBJ({ includeMap: true });
        
        // Проверяем наличие JSZip
        if (typeof JSZip === 'undefined') {
            console.warn('[ProjectExporter] JSZip не загружен, скачиваем файлы по отдельности');
            alert('Библиотека JSZip не подключена.\n\nДобавьте в index.html:\n<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>\n\nФайлы будут скачаны по отдельности.');
            this._downloadOBJSeparate(filename, obj, mtl, materials);
            return;
        }
        
        try {
            const zip = new JSZip();
            
            // Добавляем OBJ с ссылкой на MTL
            const objWithMtl = `mtllib ${filename}.mtl\n` + obj;
            zip.file(`${filename}.obj`, objWithMtl);
            
            // Добавляем MTL
            zip.file(`${filename}.mtl`, mtl);
            
            // Добавляем текстуры
            let textureCount = 0;
            let textureExpected = 0;
            
            for (const [name, props] of materials) {
                if (props.texture && props.map) {
                    textureExpected++;
                    const dataURL = this._textureToDataURL(props.texture);
                    if (dataURL) {
                        // Конвертируем data URL в blob
                        const base64 = dataURL.split(',')[1];
                        zip.file(props.map, base64, { base64: true });
                        textureCount++;
                    }
                }
            }
            
            // Если текстуры не экспортировались — добавляем скриншот
            if (textureExpected > 0 && textureCount === 0) {
                const screenshot = this._captureMapScreenshot();
                if (screenshot) {
                    const base64 = screenshot.split(',')[1];
                    zip.file('map_screenshot.png', base64, { base64: true });
                    console.log('[ProjectExporter] Добавлен скриншот карты');
                }
            }
            
            // Добавляем README
            const readme = this._generateReadme(filename, textureCount, textureExpected);
            zip.file('README.txt', readme);
            
            // Генерируем ZIP и скачиваем
            const blob = await zip.generateAsync({ 
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });
            
            // Пробуем File System Access API для выбора пути
            if (window.showSaveFilePicker) {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: `${filename}.zip`,
                        types: [{
                            description: 'ZIP Archive',
                            accept: { 'application/zip': ['.zip'] }
                        }]
                    });
                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    console.log(`[ProjectExporter] ZIP сохранён: ${handle.name}`);
                } catch (e) {
                    if (e.name !== 'AbortError') {
                        // Fallback к обычному скачиванию
                        this._downloadBlob(blob, `${filename}.zip`);
                    }
                }
            } else {
                // Браузер не поддерживает File System Access API
                this._downloadBlob(blob, `${filename}.zip`);
            }
            
            console.log(`[ProjectExporter] ZIP: OBJ + MTL + ${textureCount} текстур`);
            
        } catch (e) {
            console.error('[ProjectExporter] Ошибка создания ZIP:', e);
            alert('Ошибка создания ZIP архива. Скачиваем файлы по отдельности.');
            this._downloadOBJSeparate(filename, obj, mtl, materials);
        }
    }
    
    /**
     * Fallback: скачать файлы по отдельности
     */
    _downloadOBJSeparate(filename, obj, mtl, materials) {
        const objWithMtl = `mtllib ${filename}.mtl\n` + obj;
        
        this._downloadFile(objWithMtl, `${filename}.obj`, 'text/plain');
        this._downloadFile(mtl, `${filename}.mtl`, 'text/plain');
        
        // Скачиваем текстуры с задержкой чтобы браузер не блокировал
        let delay = 500;
        materials.forEach((props, name) => {
            if (props.texture && props.map) {
                setTimeout(() => {
                    const dataURL = this._textureToDataURL(props.texture);
                    if (dataURL) {
                        this._downloadDataURL(dataURL, props.map);
                    }
                }, delay);
                delay += 300;
            }
        });
    }
    
    /**
     * Скачать blob как файл
     */
    _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    /**
     * Захват скриншота карты (без зданий)
     */
    _captureMapScreenshot() {
        try {
            const renderer = this.sceneManager.renderer;
            const scene = this.sceneManager.scene;
            const camera = this.sceneManager.camera;
            
            // Сохраняем состояние
            const savedPos = camera.position.clone();
            const savedTarget = this.sceneManager.controls?.target?.clone();
            const buildingsGroup = this.sceneManager.getBuildingsGroup();
            const wasVisible = buildingsGroup.visible;
            
            // Вид сверху
            camera.position.set(0, 0, 500);
            camera.lookAt(0, 0, 0);
            camera.updateProjectionMatrix();
            buildingsGroup.visible = false;
            
            // Рендерим
            renderer.render(scene, camera);
            const dataURL = renderer.domElement.toDataURL('image/png');
            
            // Восстанавливаем
            buildingsGroup.visible = wasVisible;
            camera.position.copy(savedPos);
            if (savedTarget && this.sceneManager.controls) {
                this.sceneManager.controls.target.copy(savedTarget);
            }
            camera.updateProjectionMatrix();
            renderer.render(scene, camera);
            
            return dataURL;
        } catch (e) {
            console.warn('[ProjectExporter] Не удалось сделать скриншот:', e);
            return null;
        }
    }
    
    /**
     * Генерировать README для архива
     */
    _generateReadme(filename, textureCount, textureExpected) {
        return `Insol Web OBJ Export
====================
Exported: ${new Date().toISOString()}

Files:
- ${filename}.obj - 3D geometry
- ${filename}.mtl - materials
${textureCount > 0 ? `- map_tile_*.png - ${textureCount} map textures` : ''}
${textureExpected > 0 && textureCount === 0 ? '- map_screenshot.png - map screenshot (textures could not be exported due to CORS)' : ''}

Usage in Rhino:
1. Open ${filename}.obj
2. Rhino will automatically load the MTL file
3. Textures should appear on map tiles

Usage in 3ds Max / SketchUp:
1. Import ${filename}.obj
2. Make sure MTL and PNG files are in the same folder

Coordinate System:
- Units: meters
- Y-up (converted from Z-up)

Generated by Insol Web v0.3
`;
    }
    
    /**
     * Скачать Data URL как файл
     */
    _downloadDataURL(dataURL, filename) {
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
    
    // ========================================
    // Utilities
    // ========================================
    
    _downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
        
        console.log(`[ProjectExporter] Скачан: ${filename}`);
    }
}

export { ProjectExporter };
window.ProjectExporter = ProjectExporter;