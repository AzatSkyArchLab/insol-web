/**
 * ============================================
 * SolarRadiation.js v5.1
 * Direct Sun Hours - Client-Side
 * ============================================
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
        
        console.log('[SolarRadiation] v5.1');
    }
    
    async checkServer() {
        return true;
    }
    
    // ============================================
    // EPW Parser
    // ============================================
    
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
                    
                    console.log(`[SolarRadiation] EPW: ${location.city}, lat=${location.latitude}, lon=${location.longitude}`);
                    
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
    
    // ============================================
    // Sun Position
    // ============================================
    
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
    
    // ============================================
    // Mesh Processing
    // ============================================
    
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
                
                const v0 = new THREE.Vector3(x, y, 0);
                const v1 = new THREE.Vector3(x + stepX, y, 0);
                const v2 = new THREE.Vector3(x + stepX, y + stepY, 0);
                const v3 = new THREE.Vector3(x, y + stepY, 0);
                
                const center = new THREE.Vector3(x + stepX/2, y + stepY/2, 0);
                const normal = new THREE.Vector3(0, 0, 1);
                
                faces.push({
                    vertices: [v0, v1, v2, v3],
                    center,
                    normal,
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
                center,
                normal: normal.clone(),
                area,
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
    
    _extractFacesWithSubdivision(mesh, targetArea, maxFaces = 5000) {
        const geometry = mesh.geometry;
        const position = geometry.attributes.position;
        const index = geometry.index;
        
        mesh.updateMatrixWorld();
        const matrix = mesh.matrixWorld;
        
        const faces = [];
        
        const processTriangle = (i0, i1, i2) => {
            if (faces.length >= maxFaces) return;
            
            const v0 = new THREE.Vector3().fromBufferAttribute(position, i0).applyMatrix4(matrix);
            const v1 = new THREE.Vector3().fromBufferAttribute(position, i1).applyMatrix4(matrix);
            const v2 = new THREE.Vector3().fromBufferAttribute(position, i2).applyMatrix4(matrix);
            
            const edge1 = new THREE.Vector3().subVectors(v1, v0);
            const edge2 = new THREE.Vector3().subVectors(v2, v0);
            const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
            
            if (normal.z < -0.3) return;
            
            const subdivided = this._subdivideTriangle(v0, v1, v2, normal, targetArea);
            
            for (const face of subdivided) {
                if (faces.length >= maxFaces) break;
                faces.push(face);
            }
        };
        
        if (index) {
            for (let i = 0; i < index.count; i += 3) {
                if (faces.length >= maxFaces) break;
                processTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
            }
        } else {
            for (let i = 0; i < position.count; i += 3) {
                if (faces.length >= maxFaces) break;
                processTriangle(i, i + 1, i + 2);
            }
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
    
    // ============================================
    // Analysis
    // ============================================
    
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
            
            console.log(`[SolarRadiation] Анализ ${meshes.length} зданий...`);
            
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
            console.log(`[SolarRadiation] Солнечных позиций: ${sunVectors.length}`);
            
            if (sunVectors.length === 0) {
                throw new Error('Нет солнечных позиций для выбранного периода');
            }
            
            const bbox = this._computeBoundingBox(meshes);
            
            this._updateProgress('Создание сетки земли...', 10);
            await this._sleep(10);
            
            const groundFaces = this._createGroundMesh(bbox, groundBuffer, groundTargetArea);
            console.log(`[SolarRadiation] Ground: ${groundFaces.length} ячеек`);
            
            this._updateProgress('Subdivision зданий...', 15);
            await this._sleep(10);
            
            let buildingFaces = [];
            for (const mesh of meshes) {
                const faces = this._extractFacesWithSubdivision(mesh, targetFaceArea);
                buildingFaces = buildingFaces.concat(faces);
            }
            console.log(`[SolarRadiation] Здания: ${buildingFaces.length} граней`);
            
            const obstacles = this._collectObstacles();
            console.log(`[SolarRadiation] Препятствия: ${obstacles.length}`);
            
            const allFaces = [...groundFaces, ...buildingFaces];
            const totalFaces = allFaces.length;
            
            console.log(`[SolarRadiation] Всего: ${totalFaces} точек × ${sunVectors.length} солнц`);
            
            this._updateProgress('Ray casting...', 20);
            
            const sunHours = new Array(totalFaces).fill(0);
            const progressStep = Math.max(1, Math.floor(totalFaces / 25));
            
            for (let faceIdx = 0; faceIdx < totalFaces; faceIdx++) {
                const face = allFaces[faceIdx];
                
                for (const sunVec of sunVectors) {
                    const cosIncidence = face.normal.dot(sunVec);
                    if (cosIncidence <= 0.01) continue;
                    
                    if (!this._isShaded(face.center, sunVec, obstacles)) {
                        sunHours[faceIdx]++;
                    }
                }
                
                if (faceIdx % progressStep === 0) {
                    const pct = 20 + Math.floor(faceIdx / totalFaces * 75);
                    this._updateProgress(`Ray casting... ${Math.floor(faceIdx / totalFaces * 100)}%`, pct);
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
            
            const hours = sunHours;
            const stats = {
                total_faces: totalFaces,
                ground_faces: groundFaces.length,
                building_faces: buildingFaces.length,
                sun_vectors_count: sunVectors.length,
                min_hours: Math.min(...hours),
                max_hours: Math.max(...hours),
                mean_hours: hours.reduce((a, b) => a + b, 0) / hours.length,
                time_seconds: elapsed.toFixed(1)
            };
            
            const result = {
                success: true,
                mode: 'sun_hours',
                faces: results,
                statistics: stats
            };
            
            console.log(`[SolarRadiation] Готово за ${elapsed.toFixed(1)}s`);
            console.log(`[SolarRadiation] ${stats.min_hours}-${stats.max_hours} часов (среднее ${stats.mean_hours.toFixed(0)})`);
            
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
    
    // ============================================
    // Visualization
    // ============================================
    
    _visualizeResults(result) {
        this.clearVisualization();
        
        const faces = result.faces;
        if (!faces || faces.length === 0) return;
        
        const values = faces.map(f => f.sun_hours || 0);
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        
        const positions = [];
        const colors = [];
        
        for (const face of faces) {
            const value = face.sun_hours || 0;
            const t = maxVal > minVal ? (value - minVal) / (maxVal - minVal) : 0;
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
                
                for (let i = 0; i < 6; i++) {
                    colors.push(color.r, color.g, color.b);
                }
            } else if (verts.length === 3) {
                const [v0, v1, v2] = verts;
                
                const n = face.normal;
                const off = 0.02;
                
                positions.push(v0.x + n[0]*off, v0.y + n[1]*off, v0.z + n[2]*off);
                positions.push(v1.x + n[0]*off, v1.y + n[1]*off, v1.z + n[2]*off);
                positions.push(v2.x + n[0]*off, v2.y + n[1]*off, v2.z + n[2]*off);
                
                for (let i = 0; i < 3; i++) {
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
                
            case 'thermal':
            case 'red':
                if (t < 0.33) {
                    r = t / 0.33; g = 0; b = 0;
                } else if (t < 0.66) {
                    r = 1; g = (t - 0.33) / 0.33; b = 0;
                } else {
                    r = 1; g = 1; b = (t - 0.66) / 0.34;
                }
                break;
                
            case 'cool':
            case 'blue':
                r = t * 0.8;
                g = t;
                b = 0.4 + t * 0.6;
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
                
            case 'rainbow':
                const h = (1 - t) * 0.7;
                const s = 1, l = 0.5;
                const c = (1 - Math.abs(2 * l - 1)) * s;
                const x = c * (1 - Math.abs((h * 6) % 2 - 1));
                const m = l - c / 2;
                
                if (h < 1/6) { r = c; g = x; b = 0; }
                else if (h < 2/6) { r = x; g = c; b = 0; }
                else if (h < 3/6) { r = 0; g = c; b = x; }
                else if (h < 4/6) { r = 0; g = x; b = c; }
                else if (h < 5/6) { r = x; g = 0; b = c; }
                else { r = c; g = 0; b = x; }
                
                r += m; g += m; b += m;
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
            thermal: 'linear-gradient(to right, #000, #f00, #ff0, #fff)',
            red: 'linear-gradient(to right, #000, #f00, #ff0, #fff)',
            cool: 'linear-gradient(to right, #006, #0af, #fff)',
            blue: 'linear-gradient(to right, #006, #0af, #fff)',
            hot: 'linear-gradient(to right, #000, #f00, #f80, #ff0)',
            rainbow: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f)',
            grayscale: 'linear-gradient(to right, #000, #fff)'
        };
        
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
                <span>${min} ч</span><span>${max} ч</span>
            </div>
            <div style="border-top: 1px solid #eee; padding-top: 8px; color: #666; font-size: 11px;">
                <div>Точек: ${stats.total_faces?.toLocaleString()}</div>
                <div>Среднее: ${stats.mean_hours?.toFixed(0)} ч</div>
                <div>Время: ${stats.time_seconds}s</div>
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
    }
    
    setColorScale(scale) {
        this.colorScale = scale;
        if (this.lastResults) {
            this._visualizeResults(this.lastResults);
        }
    }
    
    dispose() {
        this.clearVisualization();
    }
}

export { SolarRadiation };
window.SolarRadiation = SolarRadiation;