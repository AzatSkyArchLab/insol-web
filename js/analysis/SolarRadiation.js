/**
 * SolarRadiation.js v5.2
 * Direct Sun Hours - Client-Side
 */

class SolarRadiation {
    constructor(sceneManager, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        
        this.resultMesh = null;
        this.legendElement = null;
        this.lastResults = null;
        this.isCalculating = false;
        this.epwData = null;
        
        this.raycaster = new THREE.Raycaster();
        this.colorScale = options.colorScale || 'viridis';
        this.onProgress = options.onProgress || null;
        
        // Для умного клика
        this.mouseDownPos = null;
        this.mouseDownTime = 0;
        this.wasDragging = false;
        this.tooltip = null;
        this._clickHandlerActive = false;
        
        console.log('[SolarRadiation] v5.2');
    }
    
    // ============================================
    // Smart Click для показа часов
    // ============================================
    
    _initClickHandler() {
        // Защита от двойной инициализации
        if (this._clickHandlerActive) return;
        
        const canvas = this.sceneManager.renderer.domElement;
        
        this._onMouseDownHandler = (e) => {
            if (e.button !== 0) return;
            this.mouseDownPos = { x: e.clientX, y: e.clientY };
            this.mouseDownTime = Date.now();
            this.wasDragging = false; // Сбрасываем при новом нажатии
        };
        
        this._onMouseMoveHandler = (e) => {
            // Если двигаем мышь с нажатой кнопкой - отмечаем что это drag
            if (this.mouseDownPos && !this.wasDragging) {
                const dx = e.clientX - this.mouseDownPos.x;
                const dy = e.clientY - this.mouseDownPos.y;
                if (Math.sqrt(dx * dx + dy * dy) > 3) {
                    this.wasDragging = true;
                }
            }
        };
        
        this._onClickHandler = (e) => {
            if (e.button !== 0) return;
            if (!this.resultMesh || !this.lastResults) return;
            
            // Если был drag - это завершающий клик после перемещения, пропускаем
            if (this.wasDragging) {
                this.wasDragging = false;
                this.mouseDownPos = null;
                return;
            }
            
            // Проверяем время клика - долгое нажатие не считается кликом
            if (this.mouseDownPos) {
                const elapsed = Date.now() - this.mouseDownTime;
                if (elapsed > 400) {
                    this.mouseDownPos = null;
                    return;
                }
            }
            
            this.mouseDownPos = null;
            
            // Чистый клик - показываем информацию
            this._showHoursAtClick(e);
        };
        
        canvas.addEventListener('mousedown', this._onMouseDownHandler);
        canvas.addEventListener('mousemove', this._onMouseMoveHandler);
        canvas.addEventListener('click', this._onClickHandler);
        
        this._clickHandlerActive = true;
    }
    
    _removeClickHandler() {
        if (!this._clickHandlerActive) return;
        
        const canvas = this.sceneManager.renderer?.domElement;
        if (canvas) {
            if (this._onMouseDownHandler) canvas.removeEventListener('mousedown', this._onMouseDownHandler);
            if (this._onMouseMoveHandler) canvas.removeEventListener('mousemove', this._onMouseMoveHandler);
            if (this._onClickHandler) canvas.removeEventListener('click', this._onClickHandler);
        }
        
        this._clickHandlerActive = false;
    }
    
    _showHoursAtClick(e) {
        const canvas = this.sceneManager.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        
        const mouse = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        
        this.raycaster.setFromCamera(mouse, this.sceneManager.camera);
        
        const intersects = this.raycaster.intersectObject(this.resultMesh, false);
        
        if (intersects.length === 0) {
            this._hideTooltip();
            return;
        }
        
        const hit = intersects[0];
        const faceIndex = hit.faceIndex;
        
        // Найти соответствующий face в результатах
        const faces = this.lastResults.faces;
        
        let triangleCount = 0;
        let foundFace = null;
        
        for (const face of faces) {
            const numTriangles = face.isGround && face.vertices.length === 4 ? 2 : 1;
            
            if (faceIndex >= triangleCount && faceIndex < triangleCount + numTriangles) {
                foundFace = face;
                break;
            }
            
            triangleCount += numTriangles;
        }
        
        if (foundFace) {
            const factor = this.lastResults.statistics?.extrapolation_factor || 1;
            const realHours = Math.round(foundFace.sun_hours * factor);
            const type = foundFace.isGround ? 'Земля' : 'Здание';
            this._showTooltip(e.clientX, e.clientY, `${realHours} ч`, type);
        }
    }
    
    _showTooltip(x, y, text, subtitle) {
        if (!this.tooltip) {
            this.tooltip = document.createElement('div');
            this.tooltip.id = 'solar-tooltip';
            this.tooltip.style.cssText = `
                position: fixed;
                background: rgba(0, 0, 0, 0.85);
                color: white;
                padding: 8px 12px;
                border-radius: 6px;
                font-family: system-ui, sans-serif;
                font-size: 14px;
                font-weight: 600;
                pointer-events: none;
                z-index: 10000;
                transform: translate(-50%, -100%);
                margin-top: -10px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            `;
            document.body.appendChild(this.tooltip);
        }
        
        this.tooltip.innerHTML = `
            <div style="text-align: center;">
                <div>☀️ ${text}</div>
                ${subtitle ? `<div style="font-size: 11px; font-weight: normal; opacity: 0.7; margin-top: 2px;">${subtitle}</div>` : ''}
            </div>
        `;
        this.tooltip.style.left = x + 'px';
        this.tooltip.style.top = y + 'px';
        this.tooltip.style.display = 'block';
        
        // Автоскрытие через 2 секунды
        clearTimeout(this._tooltipTimeout);
        this._tooltipTimeout = setTimeout(() => this._hideTooltip(), 2000);
    }
    
    _hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
        }
    }
    
    async checkServer() {
        return true;
    }
    
    loadEPW(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    const content = e.target.result;
                    const lines = content.split('\n');
                    
                    const header = lines[0].split(',');
                    const location = {
                        city: header[1] || 'Unknown',
                        region: header[2] || '',
                        country: header[3] || '',
                        latitude: parseFloat(header[6]) || 55.75,
                        longitude: parseFloat(header[7]) || 37.62,
                        timezone: parseFloat(header[8]) || 3,
                        elevation: parseFloat(header[9]) || 0
                    };
                    
                    const hourlyData = [];
                    for (let i = 8; i < lines.length; i++) {
                        const cols = lines[i].split(',');
                        if (cols.length < 20) continue;
                        
                        hourlyData.push({
                            year: parseInt(cols[0]),
                            month: parseInt(cols[1]),
                            day: parseInt(cols[2]),
                            hour: parseInt(cols[3]),
                            ghi: parseFloat(cols[13]) || 0,
                            dni: parseFloat(cols[14]) || 0,
                            dhi: parseFloat(cols[15]) || 0
                        });
                    }
                    
                    this.epwData = { location, hourlyData };
                    console.log('[SolarRadiation] EPW:', location.city, location.latitude, location.longitude);
                    resolve(this.epwData);
                } catch (err) {
                    reject(new Error('Ошибка парсинга EPW: ' + err.message));
                }
            };
            
            reader.onerror = () => reject(new Error('Ошибка чтения файла'));
            reader.readAsText(file);
        });
    }
    
    getLocation() {
        if (this.epwData) return this.epwData.location;
        return { latitude: 55.75, longitude: 37.62, timezone: 3, city: 'Default' };
    }
    
    hasEPW() {
        return this.epwData !== null;
    }
    
    _getSunPosition(date, lat, lon) {
        const y = date.getFullYear();
        let m = date.getMonth() + 1;
        const d = date.getDate() + date.getHours() / 24 + date.getMinutes() / 1440;
        
        let year = y, month = m;
        if (m <= 2) { year--; month += 12; }
        
        const JD = Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + d + 2 - Math.floor(year / 100) + Math.floor(year / 400) - 1524.5;
        const n = JD - 2451545.0;
        
        const L = (280.460 + 0.9856474 * n) % 360;
        const g = ((357.528 + 0.9856003 * n) % 360) * Math.PI / 180;
        const lambda = L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g);
        
        const eps = 23.439 * Math.PI / 180;
        const lambdaRad = lambda * Math.PI / 180;
        
        const delta = Math.asin(Math.sin(eps) * Math.sin(lambdaRad));
        const alpha = Math.atan2(Math.cos(eps) * Math.sin(lambdaRad), Math.cos(lambdaRad));
        
        const H = ((280.46061837 + 360.98564736629 * n + lon) % 360 - alpha * 180 / Math.PI) * Math.PI / 180;
        const latRad = lat * Math.PI / 180;
        
        const altitude = Math.asin(Math.sin(latRad) * Math.sin(delta) + Math.cos(latRad) * Math.cos(delta) * Math.cos(H));
        const azimuth = Math.atan2(-Math.sin(H), Math.tan(delta) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(H));
        
        return {
            altitude: altitude * 180 / Math.PI,
            azimuth: (azimuth * 180 / Math.PI + 360) % 360
        };
    }
    
    _generateSunVectors(options) {
        const {
            latitude, longitude,
            year = 2024,
            startMonth = 1, startDay = 1, startHour = 6,
            endMonth = 12, endDay = 31, endHour = 20,
            dayStep = 1, hourStep = 1, minAltitude = 5.0
        } = options;
        
        const vectors = [];
        const startDate = new Date(year, startMonth - 1, startDay, startHour);
        const endDate = new Date(year, endMonth - 1, endDay, endHour);
        
        let dayCount = 0;
        const current = new Date(startDate);
        current.setHours(0, 0, 0, 0);
        
        while (current <= endDate) {
            if (dayCount % dayStep === 0) {
                for (let hour = startHour; hour <= endHour; hour += hourStep) {
                    const date = new Date(current);
                    date.setHours(hour);
                    
                    if (date < startDate || date > endDate) continue;
                    
                    const sun = this._getSunPosition(date, latitude, longitude);
                    
                    if (sun.altitude >= minAltitude) {
                        const altRad = sun.altitude * Math.PI / 180;
                        const azRad = sun.azimuth * Math.PI / 180;
                        
                        vectors.push(new THREE.Vector3(
                            Math.cos(altRad) * Math.sin(azRad),
                            Math.cos(altRad) * Math.cos(azRad),
                            Math.sin(altRad)
                        ));
                    }
                }
            }
            current.setDate(current.getDate() + 1);
            dayCount++;
        }
        
        return vectors;
    }
    
    _createGroundMesh(bbox, buffer, targetArea) {
        const x0 = bbox.minX - buffer;
        const x1 = bbox.maxX + buffer;
        const y0 = bbox.minY - buffer;
        const y1 = bbox.maxY + buffer;
        
        const width = x1 - x0;
        const height = y1 - y0;
        
        const cellSize = Math.sqrt(targetArea);
        let nx = Math.max(2, Math.ceil(width / cellSize));
        let ny = Math.max(2, Math.ceil(height / cellSize));
        
        const maxCells = 2500;
        if (nx * ny > maxCells) {
            const ratio = Math.sqrt(maxCells / (nx * ny));
            nx = Math.max(2, Math.floor(nx * ratio));
            ny = Math.max(2, Math.floor(ny * ratio));
        }
        
        const stepX = width / nx;
        const stepY = height / ny;
        const faces = [];
        
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const x = x0 + i * stepX;
                const y = y0 + j * stepY;
                
                faces.push({
                    vertices: [
                        new THREE.Vector3(x, y, 0),
                        new THREE.Vector3(x + stepX, y, 0),
                        new THREE.Vector3(x + stepX, y + stepY, 0),
                        new THREE.Vector3(x, y + stepY, 0)
                    ],
                    center: new THREE.Vector3(x + stepX/2, y + stepY/2, 0),
                    normal: new THREE.Vector3(0, 0, 1),
                    area: stepX * stepY,
                    isGround: true
                });
            }
        }
        
        return faces;
    }
    
    _subdivideTriangle(v0, v1, v2, normal, targetArea, maxDepth = 4, depth = 0) {
        const edge1 = new THREE.Vector3().subVectors(v1, v0);
        const edge2 = new THREE.Vector3().subVectors(v2, v0);
        const area = new THREE.Vector3().crossVectors(edge1, edge2).length() * 0.5;
        
        if (area <= targetArea || depth >= maxDepth) {
            const center = new THREE.Vector3().addVectors(v0, v1).add(v2).divideScalar(3);
            return [{
                vertices: [v0.clone(), v1.clone(), v2.clone()],
                center: center,
                normal: normal.clone(),
                area: area,
                isGround: false
            }];
        }
        
        const m01 = new THREE.Vector3().addVectors(v0, v1).multiplyScalar(0.5);
        const m12 = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
        const m20 = new THREE.Vector3().addVectors(v2, v0).multiplyScalar(0.5);
        
        const results = [];
        results.push(...this._subdivideTriangle(v0, m01, m20, normal, targetArea, maxDepth, depth + 1));
        results.push(...this._subdivideTriangle(m01, v1, m12, normal, targetArea, maxDepth, depth + 1));
        results.push(...this._subdivideTriangle(m20, m12, v2, normal, targetArea, maxDepth, depth + 1));
        results.push(...this._subdivideTriangle(m01, m12, m20, normal, targetArea, maxDepth, depth + 1));
        
        return results;
    }
    
    _extractFacesWithSubdivision(mesh, targetArea, maxFaces = 50000) {
        const geometry = mesh.geometry;
        
        if (!geometry) {
            console.warn('[SolarRadiation] Mesh has no geometry:', mesh.userData?.id);
            return [];
        }
        
        const position = geometry.attributes.position;
        
        if (!position) {
            console.warn('[SolarRadiation] Geometry has no position attribute:', mesh.userData?.id);
            return [];
        }
        
        const index = geometry.index;
        
        mesh.updateMatrixWorld();
        const matrix = mesh.matrixWorld;
        const faces = [];
        
        let skippedSmall = 0;
        let totalTriangles = 0;
        
        const processTriangle = (i0, i1, i2) => {
            // Проверка индексов
            if (i0 >= position.count || i1 >= position.count || i2 >= position.count) {
                return;
            }
            
            totalTriangles++;
            
            const v0 = new THREE.Vector3().fromBufferAttribute(position, i0).applyMatrix4(matrix);
            const v1 = new THREE.Vector3().fromBufferAttribute(position, i1).applyMatrix4(matrix);
            const v2 = new THREE.Vector3().fromBufferAttribute(position, i2).applyMatrix4(matrix);
            
            const edge1 = new THREE.Vector3().subVectors(v1, v0);
            const edge2 = new THREE.Vector3().subVectors(v2, v0);
            let normal = new THREE.Vector3().crossVectors(edge1, edge2);
            
            const area = normal.length() * 0.5;
            
            // Пропускаем только совсем вырожденные треугольники
            if (area < 0.0001) {
                skippedSmall++;
                return;
            }
            
            normal.normalize();
            
            // Переворачиваем нормаль если смотрит вниз (исправляем развёрнутые нормали)
            if (normal.z < 0) {
                normal.negate();
            }
            
            const subdivided = this._subdivideTriangle(v0, v1, v2, normal, targetArea);
            
            for (const face of subdivided) {
                faces.push(face);
            }
        };
        
        if (index) {
            console.log(`[SolarRadiation] Indexed geometry: ${index.count} indices, ${position.count} vertices`);
            for (let i = 0; i < index.count; i += 3) {
                processTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
            }
        } else {
            console.log(`[SolarRadiation] Non-indexed geometry: ${position.count} vertices`);
            for (let i = 0; i < position.count; i += 3) {
                processTriangle(i, i + 1, i + 2);
            }
        }
        
        console.log(`[SolarRadiation] Result: ${totalTriangles} triangles, ${skippedSmall} skipped, ${faces.length} faces`);
        
        // Если слишком много faces - прореживаем равномерно
        if (faces.length > maxFaces) {
            console.warn(`[SolarRadiation] Too many faces (${faces.length}), sampling down to ${maxFaces}`);
            const step = faces.length / maxFaces;
            const sampled = [];
            for (let i = 0; i < maxFaces; i++) {
                sampled.push(faces[Math.floor(i * step)]);
            }
            return sampled;
        }
        
        return faces;
    }
    
    _collectObstacles() {
        const obstacles = [];
        const buildingsGroup = this.sceneManager.getBuildingsGroup();
        
        buildingsGroup.traverse((child) => {
            if (child.isMesh && child.geometry && child.visible) {
                obstacles.push(child);
            }
        });
        
        return obstacles;
    }
    
    _isShaded(origin, sunDirection, obstacles) {
        const offsetOrigin = origin.clone().add(sunDirection.clone().multiplyScalar(0.15));
        
        this.raycaster.set(offsetOrigin, sunDirection);
        this.raycaster.far = 1000;
        
        const intersects = this.raycaster.intersectObjects(obstacles, false);
        return intersects.length > 0;
    }
    
    _computeBoundingBox(meshes) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        for (const mesh of meshes) {
            mesh.geometry.computeBoundingBox();
            const box = mesh.geometry.boundingBox;
            mesh.updateMatrixWorld();
            
            const worldMin = box.min.clone().applyMatrix4(mesh.matrixWorld);
            const worldMax = box.max.clone().applyMatrix4(mesh.matrixWorld);
            
            minX = Math.min(minX, worldMin.x, worldMax.x);
            maxX = Math.max(maxX, worldMin.x, worldMax.x);
            minY = Math.min(minY, worldMin.y, worldMax.y);
            maxY = Math.max(maxY, worldMin.y, worldMax.y);
        }
        
        return { minX, maxX, minY, maxY };
    }
    
    async analyzeBuildings(selectedMeshes, options = {}) {
        if (this.isCalculating) {
            throw new Error('Расчёт уже выполняется');
        }
        
        this.isCalculating = true;
        
        try {
            const meshes = Array.isArray(selectedMeshes) ? selectedMeshes : [selectedMeshes];
            
            if (meshes.length === 0) {
                throw new Error('Не выбрано ни одного здания');
            }
            
            console.log('[SolarRadiation] Анализ', meshes.length, 'зданий...');
            
            const loc = this.epwData?.location || options.location || { latitude: 55.75, longitude: 37.62 };
            
            const {
                year = 2024,
                startMonth = 1, startDay = 1, startHour = 6,
                endMonth = 12, endDay = 31, endHour = 20,
                dayStep = 7, hourStep = 1,
                targetFaceArea = 4.0,
                groundTargetArea = 16.0,
                groundBuffer = 50
            } = options;
            
            const t0 = performance.now();
            
            this._updateProgress('Генерация солнечных позиций...', 5);
            await this._sleep(10);
            
            const sunVectors = this._generateSunVectors({
                latitude: loc.latitude,
                longitude: loc.longitude,
                year, startMonth, startDay, startHour,
                endMonth, endDay, endHour,
                dayStep, hourStep
            });
            
            console.log('[SolarRadiation] Солнечных позиций:', sunVectors.length);
            
            if (sunVectors.length === 0) {
                throw new Error('Нет солнечных позиций для выбранного периода');
            }
            
            // Считаем реальное количество дней в периоде и коэффициент экстраполяции
            const startDate = new Date(year, startMonth - 1, startDay);
            const endDate = new Date(year, endMonth - 1, endDay);
            const totalDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
            const sampledDays = Math.ceil(totalDays / dayStep);
            const extrapolationFactor = totalDays / sampledDays;
            
            console.log('[SolarRadiation] Период:', totalDays, 'дней, сэмплировано:', sampledDays, ', коэфф:', extrapolationFactor.toFixed(2));
            
            const bbox = this._computeBoundingBox(meshes);
            
            this._updateProgress('Создание сетки земли...', 10);
            await this._sleep(10);
            
            const groundFaces = this._createGroundMesh(bbox, groundBuffer, groundTargetArea);
            console.log('[SolarRadiation] Ground:', groundFaces.length, 'ячеек');
            
            this._updateProgress('Subdivision зданий...', 15);
            await this._sleep(10);
            
            let buildingFaces = [];
            const maxTotalBuildingFaces = 50000;
            
            for (let mi = 0; mi < meshes.length; mi++) {
                const mesh = meshes[mi];
                console.log(`[SolarRadiation] Processing building ${mi + 1}/${meshes.length}:`, mesh.userData?.id || 'unknown');
                const faces = this._extractFacesWithSubdivision(mesh, targetFaceArea);
                buildingFaces = buildingFaces.concat(faces);
            }
            
            // Если слишком много - прореживаем
            if (buildingFaces.length > maxTotalBuildingFaces) {
                console.warn(`[SolarRadiation] Total building faces (${buildingFaces.length}) exceeds limit, sampling to ${maxTotalBuildingFaces}`);
                const step = buildingFaces.length / maxTotalBuildingFaces;
                const sampled = [];
                for (let i = 0; i < maxTotalBuildingFaces; i++) {
                    sampled.push(buildingFaces[Math.floor(i * step)]);
                }
                buildingFaces = sampled;
            }
            
            console.log('[SolarRadiation] Здания:', buildingFaces.length, 'граней');
            
            const obstacles = this._collectObstacles();
            console.log('[SolarRadiation] Препятствия:', obstacles.length);
            
            const allFaces = [...groundFaces, ...buildingFaces];
            const totalFaces = allFaces.length;
            
            console.log('[SolarRadiation] Всего:', totalFaces, '×', sunVectors.length);
            
            this._updateProgress('Ray casting...', 20);
            
            const sunHours = new Array(totalFaces).fill(0);
            const progressStep = Math.max(1, Math.floor(totalFaces / 25));
            
            for (let faceIdx = 0; faceIdx < totalFaces; faceIdx++) {
                const face = allFaces[faceIdx];
                
                for (const sunVec of sunVectors) {
                    const cosIncidence = Math.abs(face.normal.dot(sunVec));
                    if (cosIncidence <= 0.01) continue;
                    
                    if (!this._isShaded(face.center, sunVec, obstacles)) {
                        sunHours[faceIdx]++;
                    }
                }
                
                if (faceIdx % progressStep === 0) {
                    const pct = 20 + Math.floor(faceIdx / totalFaces * 75);
                    this._updateProgress('Ray casting... ' + Math.floor(faceIdx / totalFaces * 100) + '%', pct);
                    await this._sleep(0);
                }
            }
            
            const elapsed = (performance.now() - t0) / 1000;
            
            this._updateProgress('Визуализация...', 95);
            
            const results = allFaces.map((face, i) => ({
                vertices: face.vertices,
                center: [face.center.x, face.center.y, face.center.z],
                normal: [face.normal.x, face.normal.y, face.normal.z],
                area: face.area,
                sun_hours: sunHours[i],
                isGround: face.isGround
            }));
            
            const stats = {
                total_faces: totalFaces,
                ground_faces: groundFaces.length,
                building_faces: buildingFaces.length,
                sun_vectors_count: sunVectors.length,
                total_days: totalDays,
                sampled_days: sampledDays,
                extrapolation_factor: extrapolationFactor,
                min_hours: Math.min(...sunHours) * extrapolationFactor,
                max_hours: Math.max(...sunHours) * extrapolationFactor,
                mean_hours: sunHours.reduce((a, b) => a + b, 0) / sunHours.length * extrapolationFactor,
                time_seconds: elapsed.toFixed(1)
            };
            
            const result = {
                success: true,
                mode: 'sun_hours',
                faces: results,
                statistics: stats
            };
            
            console.log('[SolarRadiation] Готово за', elapsed.toFixed(1), 's');
            
            this.lastResults = result;
            this._visualizeResults(result);
            
            this._updateProgress('Готово!', 100);
            
            return result;
            
        } finally {
            this.isCalculating = false;
        }
    }
    
    _sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
    
    _updateProgress(message, percent) {
        if (this.onProgress) {
            this.onProgress(message, percent);
        }
    }
    
    _visualizeResults(result) {
        this.clearVisualization();
        
        const faces = result.faces;
        if (!faces || faces.length === 0) return;
        
        const factor = result.statistics?.extrapolation_factor || 1;
        
        // Реальные часы = sun_hours * factor
        const values = faces.map(f => (f.sun_hours || 0) * factor);
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        
        const positions = [];
        const colors = [];
        
        for (let i = 0; i < faces.length; i++) {
            const face = faces[i];
            const realHours = (face.sun_hours || 0) * factor;
            const t = maxVal > minVal ? (realHours - minVal) / (maxVal - minVal) : 0;
            const color = this._getColor(t);
            
            const verts = face.vertices;
            
            if (face.isGround && verts.length === 4) {
                const [v0, v1, v2, v3] = verts;
                
                positions.push(v0.x, v0.y, v0.z);
                positions.push(v1.x, v1.y, v1.z);
                positions.push(v2.x, v2.y, v2.z);
                
                positions.push(v0.x, v0.y, v0.z);
                positions.push(v2.x, v2.y, v2.z);
                positions.push(v3.x, v3.y, v3.z);
                
                for (let j = 0; j < 6; j++) {
                    colors.push(color.r, color.g, color.b);
                }
            } else if (verts.length === 3) {
                const [v0, v1, v2] = verts;
                
                const n = face.normal;
                const nx = typeof n[0] === 'number' ? n[0] : n.x;
                const ny = typeof n[1] === 'number' ? n[1] : n.y;
                const nz = typeof n[2] === 'number' ? n[2] : n.z;
                const off = 0.03;
                
                positions.push(v0.x + nx*off, v0.y + ny*off, v0.z + nz*off);
                positions.push(v1.x + nx*off, v1.y + ny*off, v1.z + nz*off);
                positions.push(v2.x + nx*off, v2.y + ny*off, v2.z + nz*off);
                
                for (let j = 0; j < 3; j++) {
                    colors.push(color.r, color.g, color.b);
                }
            }
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        
        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
            depthWrite: false
        });
        
        this.resultMesh = new THREE.Mesh(geometry, material);
        this.resultMesh.renderOrder = 999;
        this.scene.add(this.resultMesh);
        
        // Включаем обработчик кликов
        this._initClickHandler();
        
        this._showLegend(minVal, maxVal, result.statistics);
    }
    
    _getColor(t) {
        t = Math.max(0, Math.min(1, t));
        let r, g, b;
        
        switch (this.colorScale) {
            case 'viridis':
                if (t < 0.25) {
                    r = 0.267 + t/0.25 * 0.016;
                    g = 0.004 + t/0.25 * 0.137;
                    b = 0.329 + t/0.25 * 0.129;
                } else if (t < 0.5) {
                    const s = (t - 0.25) / 0.25;
                    r = 0.283 - s * 0.156;
                    g = 0.141 + s * 0.425;
                    b = 0.458 + s * 0.093;
                } else if (t < 0.75) {
                    const s = (t - 0.5) / 0.25;
                    r = 0.127 + s * 0.614;
                    g = 0.566 + s * 0.307;
                    b = 0.551 - s * 0.401;
                } else {
                    const s = (t - 0.75) / 0.25;
                    r = 0.741 + s * 0.252;
                    g = 0.873 + s * 0.033;
                    b = 0.150 - s * 0.006;
                }
                break;
                
            case 'hot':
                if (t < 0.4) {
                    r = t / 0.4; g = 0; b = 0;
                } else if (t < 0.8) {
                    r = 1; g = (t - 0.4) / 0.4 * 0.65; b = 0;
                } else {
                    r = 1; g = 0.65 + (t - 0.8) / 0.2 * 0.35; b = 0;
                }
                break;
                
            case 'cool':
                r = t * 0.8;
                g = t;
                b = 0.4 + t * 0.6;
                break;
                
            default:
                r = g = b = t;
        }
        
        return { r, g, b };
    }
    
    _showLegend(min, max, stats) {
        if (this.legendElement) this.legendElement.remove();
        
        const gradients = {
            viridis: 'linear-gradient(to right, #440154, #31688e, #35b779, #fde725)',
            hot: 'linear-gradient(to right, #000, #f00, #f80, #ff0)',
            cool: 'linear-gradient(to right, #006, #0af, #fff)'
        };
        
        const factor = stats?.extrapolation_factor || 1;
        const isExtrapolated = factor > 1.01;
        const stepInfo = isExtrapolated 
            ? `<div style="color: #888; font-size: 10px;">${stats.sampled_days}/${stats.total_days} дней (×${factor.toFixed(2)})</div>` 
            : '';
        
        this.legendElement = document.createElement('div');
        this.legendElement.id = 'solar-legend';
        this.legendElement.style.cssText = `
            position: fixed; bottom: 20px; right: 20px;
            background: white; padding: 12px 16px; border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.15);
            font-family: system-ui, sans-serif; font-size: 12px; z-index: 1000;
        `;
        
        this.legendElement.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 8px;">☀️ Sun Hours</div>
            <div style="height: 16px; border-radius: 4px; background: ${gradients[this.colorScale] || gradients.viridis}; margin-bottom: 4px;"></div>
            <div style="display: flex; justify-content: space-between; color: #666; margin-bottom: 8px;">
                <span>${Math.round(min)} ч</span><span>${Math.round(max)} ч</span>
            </div>
            <div style="border-top: 1px solid #eee; padding-top: 8px; color: #666; font-size: 11px;">
                <div>Точек: ${stats.total_faces?.toLocaleString()}</div>
                <div>Среднее: ${Math.round(stats.mean_hours)} ч</div>
                <div>Время: ${stats.time_seconds}s</div>
                ${stepInfo}
            </div>
        `;
        
        document.body.appendChild(this.legendElement);
    }
    
    clearVisualization() {
        if (this.resultMesh) {
            this.scene.remove(this.resultMesh);
            this.resultMesh.geometry.dispose();
            this.resultMesh.material.dispose();
            this.resultMesh = null;
        }
        if (this.legendElement) {
            this.legendElement.remove();
            this.legendElement = null;
        }
        
        // Убираем обработчик кликов и tooltip
        this._removeClickHandler();
        this._hideTooltip();
        if (this.tooltip) {
            this.tooltip.remove();
            this.tooltip = null;
        }
    }
    
    setColorScale(scale) {
        this.colorScale = scale;
        if (this.lastResults) {
            this._visualizeResults(this.lastResults);
        }
    }
    
    dispose() {
        this.clearVisualization();
        clearTimeout(this._tooltipTimeout);
    }
}

export { SolarRadiation };
window.SolarRadiation = SolarRadiation;