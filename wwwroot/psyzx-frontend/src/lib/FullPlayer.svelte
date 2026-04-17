<script>
    import { createEventDispatcher, onMount, onDestroy, afterUpdate } from 'svelte';
    import { fly, fade, slide, scale } from 'svelte/transition';
    import { 
        currentPlaylist, 
        currentIndex, 
        isPlaying, 
        isShuffle, 
        isRepeat, 
        albumsMap, 
        playerCurrentTime, 
        playerDuration, 
        isMaxGlassActive, 
        appSessionVersion,
        isBuffering,
        isLowQualityImages,
        artistsMap,
        eqPreset, eqBandValues
    } from '../store.js';
    import { formatTime } from './utils.js';
    import { 
        setEqBand, 
        togglePlayGlobal, 
        playNextGlobal, 
        playPrevGlobal, 
        activePlayer,
        startScrubEffect,
        updateScrubEffect,
        stopScrubEffect,
        isWebAudioMode,
        getFftData,
        loadAndPlayUrl,
        preloadNextUrl,
        getBufferedPct,
        getAudioDiagnostics
    } from './audio.js';
    import { api, fetchLyricsOnFrontend } from './api.js';
    import { quintOut, expoIn, expoOut, linear } from 'svelte/easing';
    import { spring } from 'svelte/motion';
    import { get } from 'svelte/store';

    export let artistId;
    $: artist = album ? $artistsMap.get(album.artistId) : null;

    export let isOpen = false;
    const dispatch = createEventDispatcher();

    let innerWidth = 1000;
    let progressRef;
    let currentTimeRef;
    let playerEl;
    let rafId;
    let showQueue = false;
    let isLyricsFullScreen = false;
    let lyricsScrollEl;
    let isUserScrolling = false;
    let scrollTimeout;
    let lastScrolledIdx = -1;
    let isSeekingBar = false;
    let progressContainerEl;
    let isClosing = false;
    let isClosingByDrag = false;
    
    // Tap & Info State
    let coverClick = false;
    let playToggle = false;
    let isFavorite = false;
    let showHeartAnim = false;
    let tapTimeout;
    let lastTapTime = 0;

    // --- BUFFER BAR VARIABLES ---
    let bufferRef;
    let displayBufferPct = 0;
    const lerp = (start, end, amt) => (1 - amt) * start + amt * end;

    let isVisEnabled = typeof localStorage !== 'undefined' ? localStorage.getItem('psyzx_vis_enabled') !== 'false' : true;
    
    const handleGlobalVisUpdate = () => {
        isVisEnabled = localStorage.getItem('psyzx_vis_enabled') !== 'false';
    };

 // --- THREE.JS VISUALIZER ACTION (OPTIMIZED) ---
    function threeVisualizer(node) {
        let isDestroyed = false;
        let cleanup = () => {}; 

        import('three').then((THREE) => {
            if (isDestroyed) return;

            let scene, camera, renderer, visualizerMesh;
            let visualizerRafId;
            
            let originalPositions = new Float32Array(0); 
            let smoothedFftData = null; 
            let activeSpeedMultiplier = 0; 
            let currentTunnelSpeed = 0.15;  
            let currentDnaTwist = 0.15;
            
            // --- CUSTOMIZABLE PSP SETTINGS ---
            let rippleIntensity = 0.1; // Modify this to make the micro-ripples larger or smaller
            let maxTiltDegrees = 10.0; // The maximum rotation angle during heavy bass
            
            // PSP Wave States
            let transitionFactor = 0; 
            let lastPlayState_PSP = null;
            let pspWavePhase = 0; 

            let isPointsCloud = false; 

            let visSpeed = 1.0;
            let visIntensity = 1.0;

            const lerp = (start, end, factor) => (1 - factor) * start + factor * end;

            let visShape = localStorage.getItem('psyzx_vis_shape') || 'Icosahedron';
            let visMovement = localStorage.getItem('psyzx_vis_movement') || 'Hypnotic';
            
            let rawY = parseInt(localStorage.getItem('psyzx_vis_ypos'));
            let visYPos = isNaN(rawY) ? 11 : rawY;
            
            let rawDim = parseFloat(localStorage.getItem('psyzx_vis_dimension'));
            let visDimension = isNaN(rawDim) ? 1.0 : rawDim;
            
            let rawDet = parseInt(localStorage.getItem('psyzx_vis_detail'));
            let visDetail = isNaN(rawDet) ? 16 : rawDet;
            
            let visSides = localStorage.getItem('psyzx_vis_sides') || 'Default';

            const rawSpd = parseFloat(localStorage.getItem('psyzx_vis_speed'));
            visSpeed = isNaN(rawSpd) ? 1.0 : rawSpd;
            const rawInt = parseFloat(localStorage.getItem('psyzx_vis_intensity'));
            visIntensity = isNaN(rawInt) ? 1.0 : rawInt;

            const getRadialSegments = () => {
                if (visSides !== 'Default') return parseInt(visSides);
                if (visShape === 'Tunnel') return 16; 
                return 32; 
            };
            
            scene = new THREE.Scene();
            scene.fog = new THREE.Fog(0x000000, 10, 120); 
            
            camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

            renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
            renderer.setSize(node.clientWidth || window.innerWidth, node.clientHeight || window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            node.appendChild(renderer.domElement);

            const buildVisualizerMesh = () => {
                if (visualizerMesh) {
                    scene.remove(visualizerMesh);
                    visualizerMesh.geometry.dispose();
                    visualizerMesh.material.dispose();
                    visualizerMesh = null;
                }

                let geometry;
                isPointsCloud = false; 

                switch (visShape) {
                    case 'PSPWaves': {
                        const segments = Math.max(160, visDetail * 5); 
                        const width = 240;
                        geometry = new THREE.BufferGeometry();
                        const vertsPerRibbon = (segments + 1) * 2;
                        const points = new Float32Array(vertsPerRibbon * 2 * 3);
                        const indices = [];

                        for (let r = 0; r < 2; r++) {
                            const zOffset = r === 0 ? 3.0 : -3.0; 
                            for (let i = 0; i <= segments; i++) {
                                const x = (i / segments) * width - width / 2;
                                const vIdx = r * vertsPerRibbon + i * 2;
                                
                                points[vIdx * 3] = x;     
                                points[vIdx * 3 + 1] = 0;  
                                points[vIdx * 3 + 2] = zOffset;
                                
                                points[(vIdx+1) * 3] = x; 
                                points[(vIdx+1) * 3 + 1] = 0; 
                                points[(vIdx+1) * 3 + 2] = zOffset;

                                if (i < segments) {
                                    indices.push(vIdx, vIdx+1, vIdx+3, vIdx, vIdx+3, vIdx+2);
                                }
                            }
                        }
                        geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
                        geometry.setIndex(indices);
                        break;
                    }
                    case 'Tunnel':
                        geometry = new THREE.CylinderGeometry(15, 15, 300, getRadialSegments(), visDetail * 3, true); 
                        geometry.rotateX(Math.PI / 2); 
                        break;
                    case 'TorusKnot':
                        geometry = new THREE.TorusKnotGeometry(10, 3, visDetail * 2, visDetail, 2, 3);
                        break;
                    case 'DNA':
                        geometry = new THREE.CylinderGeometry(2.0, 2.0, 220, 3, visDetail * 5, true);
                        geometry.rotateZ(Math.PI / 2); 
                        break;
                    case 'Synthwave':
                        geometry = new THREE.PlaneGeometry(200, 200, Math.min(visDetail*2, 64), Math.min(visDetail*2, 64));
                        geometry.rotateX(-Math.PI / 2);
                        break;
                    default:
                        geometry = new THREE.IcosahedronGeometry(12, Math.min(visDetail, 32)); 
                        break;
                }

                if (isPointsCloud) {
                    const material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.2, transparent: true, opacity: 0.8 });
                    visualizerMesh = new THREE.Points(geometry, material);
                } else {
                    const isPSP = visShape === 'PSPWaves';
                    const material = new THREE.MeshBasicMaterial({
                        color: 0xffffff,
                        wireframe: !isPSP,
                        transparent: true,
                        opacity: isPSP ? 0.5 : (visShape === 'Tunnel' || visShape === 'Wormhole' ? 0.25 : 0.15),
                        blending: isPSP ? THREE.NormalBlending : THREE.NormalBlending,
                        side: THREE.DoubleSide,
                        depthWrite: !isPSP, 
                        vertexColors: false 
                    });
                    visualizerMesh = new THREE.Mesh(geometry, material);
                }
                
                scene.add(visualizerMesh);
                camera.rotation.set(0, 0, 0); 

                if (visShape === 'Tunnel') { camera.position.set(0, 0, 50); visualizerMesh.position.set(0, 0, 0); } 
                else if (visShape === 'Synthwave') { camera.position.set(0, 15, 80); camera.lookAt(0, 0, 0); visualizerMesh.position.set(0, -10, 0); } 
                else if (visShape === 'PSPWaves') { 
                    camera.position.set(0, 0, 60); 
                    camera.fov = 60; 
                    camera.updateProjectionMatrix(); 
                    visualizerMesh.position.y = visYPos - 5; 
                }
                else { camera.position.set(0, 0, 35); camera.fov = 75; camera.updateProjectionMatrix(); visualizerMesh.position.y = visYPos; }

                visualizerMesh.scale.set(visDimension, visDimension, visDimension);
                const positionAttribute = geometry.attributes.position;
                
                originalPositions = new Float32Array(positionAttribute.count * 3);
                for (let i = 0; i < positionAttribute.count; i++) {
                    originalPositions[i*3] = positionAttribute.getX(i);
                    originalPositions[i*3+1] = positionAttribute.getY(i);
                    originalPositions[i*3+2] = positionAttribute.getZ(i);
                }
                
                lastPlayState_PSP = null;
            };

            buildVisualizerMesh(); 

            const handleSettingsUpdate = () => {
                const newShape = localStorage.getItem('psyzx_vis_shape') || 'PSPWaves';
                let nDet = parseInt(localStorage.getItem('psyzx_vis_detail'));
                const newDetail = isNaN(nDet) ? 16 : nDet;
                const newSides = localStorage.getItem('psyzx_vis_sides') || 'Default';

                visMovement = localStorage.getItem('psyzx_vis_movement') || 'Hypnotic';
                
                let nY = parseInt(localStorage.getItem('psyzx_vis_ypos'));
                visYPos = isNaN(nY) ? 11 : nY;
                
                let nDim = parseFloat(localStorage.getItem('psyzx_vis_dimension'));
                visDimension = isNaN(nDim) ? 1.0 : nDim;

                const nSpeed = parseFloat(localStorage.getItem('psyzx_vis_speed'));
                visSpeed = isNaN(nSpeed) ? 1.0 : nSpeed;
                const nInt = parseFloat(localStorage.getItem('psyzx_vis_intensity'));
                visIntensity = isNaN(nInt) ? 1.0 : nInt;

                if (visualizerMesh) {
                    if (!['Tunnel', 'Synthwave', 'PSPWaves'].includes(visShape)) {
                        visualizerMesh.position.y = visYPos;
                    } else if (visShape === 'PSPWaves') {
                        visualizerMesh.position.y = visYPos - 5;
                    }
                    visualizerMesh.scale.set(visDimension, visDimension, visDimension);
                }

                if (newShape !== visShape || newDetail !== visDetail || newSides !== visSides) {
                    visShape = newShape; visDetail = newDetail; visSides = newSides;
                    buildVisualizerMesh();
                }
            };

            window.addEventListener('visualizer-update', handleSettingsUpdate);
            const vertex = new THREE.Vector3();

            const handleResize = () => {
                if (!node || node.clientWidth === 0 || node.clientHeight === 0) return;
                camera.aspect = node.clientWidth / node.clientHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(node.clientWidth, node.clientHeight);
            };
            
            window.addEventListener('resize', handleResize);
            const resizeObserver = new ResizeObserver(() => handleResize());
            resizeObserver.observe(node);

            let time = 0; 

            const animate = () => {
                visualizerRafId = requestAnimationFrame(animate);
                time += 0.01;
                activeSpeedMultiplier = lerp(activeSpeedMultiplier, $isPlaying ? visSpeed : 0.05, 0.05);

                if (visualizerMesh) {
                    
                    if (visShape === 'PSPWaves') {
                        if ($isPlaying) {
                            transitionFactor = lerp(transitionFactor, 1.0, 0.06);
                        } else {
                            transitionFactor = lerp(transitionFactor, 0.0, 0.4); 
                        }

                        if (lastPlayState_PSP !== $isPlaying) {
                            lastPlayState_PSP = $isPlaying;
                            visualizerMesh.material.blending = $isPlaying ? THREE.AdditiveBlending : THREE.NormalBlending;
                            visualizerMesh.material.opacity = 0.5; 
                            visualizerMesh.material.depthWrite = !$isPlaying; 
                            visualizerMesh.material.needsUpdate = true;
                        }
                    }

                    let rawFftData = null;
                    try { rawFftData = getFftData(); } catch(e) {}
                    if (!rawFftData || rawFftData.length === 0) {
                        rawFftData = new Uint8Array(256); 
                    }

                    if (rawFftData && (!smoothedFftData || smoothedFftData.length !== rawFftData.length)) {
                        smoothedFftData = new Float32Array(rawFftData.length);
                    }

                    if (rawFftData && smoothedFftData) {
                        let totalSum = 0; let bassSum = 0; let trebleSum = 0;
                        const bassCutoff = Math.floor(rawFftData.length * 0.10); 
                        const trebleStart = Math.floor(rawFftData.length * 0.60); 

                        let rawBassSum = 0;
                        for (let i = 0; i < bassCutoff; i++) rawBassSum += rawFftData[i];
                        const rawBass = (rawBassSum / bassCutoff) / 255.0;
                        const dynamicBass = Math.max(0, rawBass - 0.35) * 1.6;

                        for (let i = 0; i < rawFftData.length; i++) {
                            const target = $isPlaying ? rawFftData[i] : 0;
                            const smoothingFactor = $isPlaying ? 0.4 : 0.05; 
                            smoothedFftData[i] = lerp(smoothedFftData[i], target, smoothingFactor);
                            totalSum += smoothedFftData[i];
                            if (i < bassCutoff) bassSum += smoothedFftData[i];
                            if (i > trebleStart) trebleSum += smoothedFftData[i];
                        }

                        const audioIntensity = (totalSum / smoothedFftData.length) / 255.0; 
                        const trebleIntensity = (trebleSum / (rawFftData.length - trebleStart)) / 255.0;
                        const positions = visualizerMesh.geometry.attributes.position;
                        
                        if (visShape === 'Tunnel') {
                            const targetTunnelSpeed = 0.15 + (dynamicBass * 1.1 * visIntensity);
                            currentTunnelSpeed = targetTunnelSpeed > currentTunnelSpeed ? lerp(currentTunnelSpeed, targetTunnelSpeed, 0.8) : lerp(currentTunnelSpeed, targetTunnelSpeed, 0.05);
                            camera.position.z -= (currentTunnelSpeed * activeSpeedMultiplier);
                            if (camera.position.z <= -50) camera.position.z += 50; 
                            const targetFov = 75 + (dynamicBass * 45 * visIntensity);
                            camera.fov = lerp(camera.fov, targetFov, targetFov > camera.fov ? 0.9 : 0.1);
                            camera.updateProjectionMatrix();

                            for (let i = 0; i < positions.count; i++) {
                                vertex.set(originalPositions[i*3], originalPositions[i*3+1], originalPositions[i*3+2]);
                                const binIndex = (i * 2) % smoothedFftData.length; 
                                const audioValue = (smoothedFftData[binIndex] / 255.0) * visIntensity * 0.1; 
                                const expand = 1.0 + audioValue; 
                                positions.setXYZ(i, vertex.x * expand, vertex.y * expand, vertex.z);
                            }
                            visualizerMesh.rotation.z += (0.002 * activeSpeedMultiplier);
                        } 
                        else if (visShape === 'PSPWaves') {
                            const currentWaveSpeed = $isPlaying ? (1.0 + dynamicBass * 8.0 * visIntensity) : 1.0;
                            pspWavePhase += 0.01 * currentWaveSpeed;

                            const segments = Math.max(160, visDetail * 5);
                            const vertsPerRibbon = (segments + 1) * 2;
                            const width = 240;

                            for (let i = 0; i < positions.count; i++) {
                                vertex.set(originalPositions[i*3], originalPositions[i*3+1], originalPositions[i*3+2]);
                                
                                const ribbonIdx = Math.floor(i / vertsPerRibbon);
                                const isTop = i % 2 === 0; 
                                const xMap = (vertex.x + width/2) / width; 
                                
                                const centerDist = Math.abs(xMap - 0.5) * 2.0; 
                                const binIndex = Math.floor(centerDist * (smoothedFftData.length * 0.4)); 
                                const localAudio = (smoothedFftData[binIndex] / 255.0);

                                const speed = pspWavePhase * (1.2 + ribbonIdx * 0.4);
                                const xVal = xMap * Math.PI * 2.0; 
                                
                                let waveY = 0;
                                const baseAmp = 1.5; 
                                
                                // Significantly reduced the main amplitude so the ocean doesn't "rise"
                                const fullAmp = 4.0 * visIntensity; 
                                const currentAmp = baseAmp + (transitionFactor * fullAmp);
                                
                                if (ribbonIdx === 0) {
                                    waveY += Math.sin(xVal * 1.2 - speed * 1.0) * currentAmp;
                                    waveY += Math.cos(xVal * 2.2 - speed * 1.3) * (currentAmp * 0.35);
                                } else {
                                    waveY += Math.sin(xVal * 1.4 - speed * 0.9) * currentAmp;
                                    waveY += Math.cos(xVal * 2.5 - speed * 1.1) * (currentAmp * 0.25);
                                }

                                // MICRO-RIPPLE LOGIC
                                // Tiny, high-frequency details that ride on top of the main crests
                                if ($isPlaying) {
                                    const rippleAmp = Math.pow(localAudio, 2.0) * rippleIntensity * visIntensity * transitionFactor; 
                                    if (rippleAmp > 0.01) {
                                        waveY += Math.sin(xVal * 40.0 - speed * 3.5) * rippleAmp;
                                    }
                                }

                                const stringThickness = 0.3; 
                                const dropDistance = 120.0 * transitionFactor; 
                                
                                if (isTop) {
                                    vertex.y = waveY + stringThickness; 
                                } else {
                                    vertex.y = waveY - stringThickness - dropDistance; 
                                }
                                
                                positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
                            }
                            
                            // SUBTLE, DYNAMIC TILT LOGIC (-15 to +15 Degrees)
                            let targetRotX = Math.sin(time * 0.3) * 0.05; // Base ambient tilt
                            let targetRotY = Math.cos(time * 0.2) * 0.04;
                            let targetRotZ = 0;

                            if ($isPlaying && dynamicBass > 0.05) {
                                // maxTiltDegrees converted to radians is ~0.261 for 15 degrees
                                const maxRad = maxTiltDegrees * (Math.PI / 180.0);
                                // Pseudo-random organic sway mapped to the beat
                                const sway = (Math.sin(time * 3.1) + Math.cos(time * 2.7)) * 0.5; 
                                targetRotZ = sway * maxRad * Math.min(1.0, dynamicBass * 1.5);
                            }

                            // Smoothly ease into the target rotation so it looks natural
                            visualizerMesh.rotation.x = lerp(visualizerMesh.rotation.x, targetRotX, 0.1);
                            visualizerMesh.rotation.y = lerp(visualizerMesh.rotation.y, targetRotY, 0.1);
                            visualizerMesh.rotation.z = lerp(visualizerMesh.rotation.z, targetRotZ, 0.08);
                        }
                        else if (visShape === 'DNA') {
                            const targetTwist = 0.15 + (dynamicBass * 0.12 * visIntensity);
                            currentDnaTwist = lerp(currentDnaTwist, targetTwist, targetTwist > currentDnaTwist ? 0.7 : 0.05);
                            for (let i = 0; i < positions.count; i++) {
                                vertex.set(originalPositions[i*3], originalPositions[i*3+1], originalPositions[i*3+2]);
                                const theta = vertex.x * currentDnaTwist;
                                const y = vertex.y * Math.cos(theta) - vertex.z * Math.sin(theta);
                                const z = vertex.y * Math.sin(theta) + vertex.z * Math.cos(theta);
                                const binIndex = (i * 2) % smoothedFftData.length; 
                                const audioValue = (smoothedFftData[binIndex] / 255.0) * visIntensity * 0.2; 
                                const expand = 1.0 + audioValue; 
                                positions.setXYZ(i, vertex.x, y * expand, z * expand);
                            }
                            visualizerMesh.rotation.x += (0.005 * activeSpeedMultiplier);
                        }
                        else if (visShape === 'Synthwave') {
                            for (let i = 0; i < positions.count; i++) {
                                vertex.set(originalPositions[i*3], originalPositions[i*3+1], originalPositions[i*3+2]);
                                let movingZ = vertex.z + (time * 50 * activeSpeedMultiplier);
                                movingZ = movingZ % 200; 
                                const binIndex = Math.floor((Math.abs(vertex.x) / 100) * smoothedFftData.length) % smoothedFftData.length;
                                const audioValue = (smoothedFftData[binIndex] / 255.0) * visIntensity;
                                const elevation = audioValue * 20.0;
                                positions.setXYZ(i, vertex.x, vertex.y, movingZ - 100); 
                                positions.setY(i, elevation); 
                            }
                            if (visMovement === 'Pulsate') visualizerMesh.position.y = -10 + (Math.sin(time*2) * audioIntensity * 5 * visDimension);
                        }
                        else {
                            if (Math.abs(camera.fov - 75) > 0.1) {
                                camera.fov = lerp(camera.fov, 75, 0.1); camera.updateProjectionMatrix();
                            }
                            for (let i = 0; i < positions.count; i++) {
                                vertex.set(originalPositions[i*3], originalPositions[i*3+1], originalPositions[i*3+2]);
                                const len = vertex.length();
                                vertex.normalize(); 
                                const binIndex = (i * 2) % smoothedFftData.length; 
                                const audioValue = (smoothedFftData[binIndex] / 255.0) * visIntensity; 
                                const displacement = audioValue * 6.0; 
                                vertex.multiplyScalar(len + displacement);
                                positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
                            }
                            switch (visMovement) {
                                case 'Hypnotic': visualizerMesh.rotation.x += (0.001 * activeSpeedMultiplier); visualizerMesh.rotation.y += (0.002 * activeSpeedMultiplier); break;
                                case 'Pulsate': const standardScale = 12 * visDimension; const scaleOffset = Math.sin(time * 2) * audioIntensity * standardScale * 0.2; visualizerMesh.scale.setScalar(visDimension + scaleOffset / 12); break;
                                case 'None': visualizerMesh.scale.setScalar(visDimension); break;
                            }
                        }
                        positions.needsUpdate = true;
                    } else if (!$isPlaying && visualizerMesh) {
                       if (visMovement === 'Pulsate' && !['Tunnel','Synthwave','PSPWaves'].includes(visShape)) { visualizerMesh.scale.setScalar(visDimension); }
                       if (camera.fov > 75) { camera.fov -= 1.0; camera.updateProjectionMatrix(); }
                    }
                }
                renderer.render(scene, camera);
            };
            animate();

            cleanup = () => {
                cancelAnimationFrame(visualizerRafId);
                window.removeEventListener('resize', handleResize);
                resizeObserver.disconnect();
                window.removeEventListener('visualizer-update', handleSettingsUpdate);
                if (renderer) { node.removeChild(renderer.domElement); renderer.dispose(); }
                if (visualizerMesh) { visualizerMesh.geometry.dispose(); if (visualizerMesh.material) visualizerMesh.material.dispose(); }
            };
        });

        return { destroy() { isDestroyed = true; cleanup(); } };
    }

    function handleCoverClick(e) {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTapTime;
        clearTimeout(tapTimeout);

        if (tapLength < 300 && tapLength > 0) {
            lastTapTime = 0; 
            toggleFavorite();
            e.preventDefault();
        } else {
            tapTimeout = setTimeout(() => { coverClick = !coverClick; }, 300);
        }
        lastTapTime = currentTime;
    }

    async function toggleFavorite() {
        if (!track || !track.id) return;
        isFavorite = !isFavorite; showHeartAnim = true;
        setTimeout(() => { showHeartAnim = false; }, 800);
        if (api.toggleFavorite) {
            const success = await api.toggleFavorite(track.id, isFavorite);
            if (!success) { isFavorite = !isFavorite; }
        }
    }

    function handlePlayToggle() { playToggle = !playToggle; }

    const DEFAULT_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
    const handleImageError = (ev) => { ev.target.src = DEFAULT_PLACEHOLDER; };

    $: isMobile = innerWidth <= 768;

    let dragY = 0; let isDragging = false; let startY = 0;

    $: if (isOpen) {
        isClosing = false; isClosingByDrag = false;
        dragY = 0; startY = 0; isDragging = false;
    }

    $: if (!isOpen && !isClosingByDrag) {
        dragY = 0; isDragging = false; isClosing = true; 
    }

    const onTouchStart = (e) => {
        if (isLyricsFullScreen || showQueue || isClosingByDrag) return;
        isDragging = true; startY = e.touches[0].clientY;
    };

    const onTouchMove = (e) => {
        if (!isDragging) return;
        const currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;
        if (deltaY > 0) { dragY = deltaY; } else { dragY = deltaY * 0.25; }
    };

    const onTouchEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        if (dragY > 60) {
            isClosing = true; isClosingByDrag = true;
            const startYPos = dragY; const targetY = window.innerHeight;
            const duration = 250; const startTime = Date.now(); 
            const fall = () => { 
                const t = Math.min((Date.now() - startTime) / duration, 1);
                dragY = startYPos + (targetY - startYPos) * t; 
                if (t < 1) requestAnimationFrame(fall); else handleClose();
            };
            requestAnimationFrame(fall);
        } else { dragY = 0; }
        startY = 0;
    };

    const handleClose = () => {
        isClosing = true; dispatch('close');
        if (!isClosingByDrag) dragY = 0; 
    };

    $: if (typeof document !== 'undefined') {
        if (isOpen && isMobile) document.body.classList.add('modal-open'); 
        else document.body.classList.remove('modal-open'); 
    }

    let wasPlayerElPresent = false;

    const frameLoop = () => {
        if (showDiagnostics) {
            const liveData = getAudioDiagnostics();
            diagData = { ...diagData, ...liveData };
        }

        if (!isSeekingBar) {
            const current = $playerCurrentTime || 0;
            const duration = $playerDuration || 1;
            const pct = current / duration;

            if (progressRef && !isNaN(pct)) progressRef.style.transform = `translateZ(0) scaleX(${pct})`;
            if (currentTimeRef) {
                const formatted = formatTime(current);
                if (currentTimeRef.textContent !== formatted) currentTimeRef.textContent = formatted;
            }
        }

        let targetBuffer = 0;
        if ($isBuffering && displayBufferPct < 95) {
            targetBuffer = Math.min(displayBufferPct + 1.5, 95); 
        } else if (track && activeDownloads[track] !== undefined) {
            targetBuffer = activeDownloads[track];
        } else {
            const trueBuffer = getBufferedPct();
            const playheadPct = (($playerCurrentTime || 0) / ($playerDuration || 1)) * 100;
            targetBuffer = Math.max(trueBuffer, playheadPct);
            targetBuffer = Math.max(targetBuffer, displayBufferPct); 
            if (targetBuffer >= 98.5) targetBuffer = 100; 
        }

        displayBufferPct = lerp(displayBufferPct, targetBuffer, 0.06);
        if (bufferRef) bufferRef.style.transform = `scaleX(${displayBufferPct / 100})`;

        if (typeof document !== 'undefined') {
            const appLayout = document.getElementById('app-layout');
            if (appLayout) {
                if (playerEl && isMobile && dragY >= 0) {
                    wasPlayerElPresent = true;
                    const rect = playerEl.getBoundingClientRect();
                    const currentY = Math.max(0, rect.top);
                    const dragProgress = Math.min(1, currentY / (window.innerHeight * 0.8));
                    
                    const scale = 0.93 + (0.07 * dragProgress);
                    const translateY = 10 * (1 - dragProgress);
                    const brightness = 0.6 + (0.4 * dragProgress);
                    
                    appLayout.style.setProperty('transition', 'none', 'important');
                    appLayout.style.setProperty('transform', `scale(${scale}) translateY(${translateY}px)`, 'important');
                    appLayout.style.setProperty('filter', `brightness(${brightness})`, 'important');
                    appLayout.style.setProperty('border-radius', `${32 * (1 - dragProgress)}px`, 'important');
                } else if (wasPlayerElPresent || (!isMobile && appLayout.style.transform)) {
                    wasPlayerElPresent = false;
                    appLayout.style.removeProperty('transition');
                    appLayout.style.removeProperty('transform');
                    appLayout.style.removeProperty('filter');
                    appLayout.style.removeProperty('border-radius');
                }
            }
        }
        rafId = requestAnimationFrame(frameLoop);
    };

    let activeDownloads = {};

    onMount(() => {
        window.addEventListener('visualizer-update', handleGlobalVisUpdate);
        rafId = requestAnimationFrame(frameLoop);

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                const data = event.data;
                if (data.type === 'DOWNLOAD_PROGRESS') {
                    activeDownloads[data.trackId] = data.progress;
                    activeDownloads = { ...activeDownloads }; 
                }
                if (data.type === 'CACHE_UPDATED' && data.trackId) {
                    activeDownloads[data.trackId] = 100;
                    activeDownloads = { ...activeDownloads };
                }
            });
        }
    });

    onDestroy(() => {
        window.removeEventListener('visualizer-update', handleGlobalVisUpdate);
        if (rafId) cancelAnimationFrame(rafId);
        if (typeof document !== 'undefined') {
            document.body.classList.remove('modal-open');
            const appLayout = document.getElementById('app-layout');
            if (appLayout) {
                appLayout.style.removeProperty('transition');
                appLayout.style.removeProperty('transform');
                appLayout.style.removeProperty('filter');
                appLayout.style.removeProperty('border-radius');
            }
        }
    });

    let eqMaster = spring(0, { stiffness: 0.15, damping: 0.8 });
    let eqBands = spring($eqBandValues, { stiffness: 0.1, damping: 0.8 });
    $: $eqBands.forEach((val, i) => setEqBand(i, val));

    // --- OPTIMIZATION: Debounce heavy localStorage writes during slider drags ---
    let eqSaveTimeout;
    const saveEqDebounced = (bands) => {
        clearTimeout(eqSaveTimeout);
        eqSaveTimeout = setTimeout(() => {
            eqBandValues.set(bands); // Saves to localStorage
        }, 500); 
    };

    const syncMasterEq = (event) => {
        const val = parseFloat(event.target.value);
        eqPreset.set('Custom'); 
        eqMaster.set(val, { hard: true });
        
        const newBands = [val, val, val, val, val, val];
        eqBands.set(newBands, { hard: true });
        saveEqDebounced(newBands); 
    };

    const handleEqChange = (index, event) => {
        const val = parseFloat(event.target.value);
        eqPreset.set('Custom');
        
        eqBands.update(current => {
            current[index] = val;
            saveEqDebounced(current); 
            return current;
        }, { hard: true }); 
    };

    const applyPreset = (name) => {
        eqPreset.set(name);
        const presetValues = [...presets[name]];
        eqBands.set(presetValues);
        eqBandValues.set(presetValues); 
    };


    const presets = {
        'Flat': [0, 0, 0, 0, 0, 0], 'Full Blast': [12, 12, 12, 6, 12, 12],
        'V-Shape': [5, 2, -2, 1, 4, 6], 'Bass Boost': [6, 4, 0, 0, 0, 0],
        'Acoustic': [2, 1, 3, 1, 2, 1], 'Electronic': [5, 3, -1, 2, 4, 5],
        'Vocal Pop': [-1, -1, 3, 4, 2, 0]
    };
    let currentPreset = 'Flat';

    const handleUserScroll = () => {
        isUserScrolling = true; clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => { isUserScrolling = false; lastScrolledIdx = -1; }, 3000);
    };

    const togglePlay = () => togglePlayGlobal();
    const playNext = () => playNextGlobal(api);
    const playPrev = () => playPrevGlobal();

    const triggerScrollToTop = () => {
        const executeScroll = () => {
            const mainView = document.getElementById('main-view');
            if (mainView) mainView.scrollTo({ top: 0, behavior: 'smooth' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        requestAnimationFrame(executeScroll);
        setTimeout(executeScroll, 100); setTimeout(executeScroll, 400); 
    };

    const goArtist = () => {
        if (album && album.artistId) {
            handleClose(); window.location.hash = `#artist/${album.artistId}`; triggerScrollToTop();
        }
    };
    
    const goAlbum = () => {
        if (track && track.albumId) {
            handleClose(); window.location.hash = `#album/${track.albumId}`; triggerScrollToTop();
        }
    };

    let pendingSeekTime = null; let lastSeekX = 0; let lastSeekTime = 0;

    const onSeekStart = (e) => { 
        isSeekingBar = true; lastSeekX = e.touches ? e.touches[0].clientX : e.clientX;
        lastSeekTime = Date.now(); 
        startScrubEffect(); // FIX: Fire universally
        updateSeek(e); 
    };

    const onSeekMove = (e) => { 
        if (!isSeekingBar) return; e.preventDefault(); 
        const currentX = e.touches ? e.touches[0].clientX : e.clientX; const now = Date.now();
        const dt = Math.max(1, now - lastSeekTime);
        if (dt > 16) {
            const dx = currentX - lastSeekX; const speed = Math.abs(dx / dt); const dir = dx >= 0 ? 1 : -1;
            updateScrubEffect(speed, dir); lastSeekX = currentX; lastSeekTime = now;
        }
        updateSeek(e); 
    };

    const onSeekEnd = () => { 
        if (isSeekingBar) stopScrubEffect();
        isSeekingBar = false; 
        if (pendingSeekTime !== null) { activePlayer.currentTime = pendingSeekTime; pendingSeekTime = null; }
    };

    const updateSeek = (e) => {
        if (!$playerDuration || !progressContainerEl) return;
        const rect = progressContainerEl.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const pct = Math.max(0, Math.min(0.990, (clientX - rect.left) / rect.width));
        pendingSeekTime = pct * $playerDuration;
        if (progressRef && !isNaN(pct)) progressRef.style.transform = `translateZ(0) scaleX(${pct})`;
        if (currentTimeRef) currentTimeRef.textContent = formatTime(pendingSeekTime);
    };

    function getDynamicFontSize(text, isActive) {
        if (!isActive) return '10px';
        const containerWidth = 380; const maxFontSize = 24; const minFontSize = 10; const glyphConstant = 0.70;  
        const calculatedSize = containerWidth / (text.length * glyphConstant);
        return `${Math.min(maxFontSize, Math.max(minFontSize, calculatedSize))}px`;
    }

    const handleGlobalKeyDown = (e) => {
        if (e.key === 'Escape') {
            if (isLyricsFullScreen) isLyricsFullScreen = false;
            else if (showQueue) showQueue = false;
            else if (isOpen) handleClose();
        }
    };

    const portal = (node, isEnabled) => {
        let originalParent = node.parentNode;
        const handlePortal = (enabled) => {
            if (enabled) { document.body.appendChild(node); }
            else { if (originalParent) originalParent.appendChild(node); }
        };
        handlePortal(isEnabled);
        return {
            update(newEnabled) { handlePortal(newEnabled); },
            destroy() { if (node.parentNode) node.parentNode.removeChild(node); }
        };
    };

    const handlePresetMouseMove = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--m-x', `${e.clientX - rect.left}px`);
        e.currentTarget.style.setProperty('--m-y', `${e.clientY - rect.top}px`);
    };

   // ─── STAGGERED NETWORK WATERFALL ──────────────────────────────────────────
    $: track = $currentPlaylist[$currentIndex];
    // Prefer albumsMap (full library), fall back to inline track.album data (playlist tracks carry this)
    $: album = track
        ? ($albumsMap.get(track.albumId) || (track.album ? {
            id: track.album.id,
            title: track.album.title,
            coverPath: track.album.coverPath,
            artistId: track.album.artist?.id,
            artistName: track.album.artist?.name || 'Unknown Artist',
            tracks: []
          } : null))
        : null;
    
    // PRIORITY 1: Low-Res Image (Instant Reactivity)
    $: lowResCoverUrl = (album && album.coverPath) 
        ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&v=${$appSessionVersion}&quality=low` 
        : DEFAULT_PLACEHOLDER;

    $: artistImageUrl = (artist && artist.imagePath) 
        ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath)}&v=${$appSessionVersion}&quality=${$isLowQualityImages ? 'low' : 'high'}` 
        : DEFAULT_PLACEHOLDER;

    // --- STATE FOR SYNCED LOADING ---
    let currentAlbumId = null;
    let currentTrackIdForLyrics = null;
    let isHighResLoaded = false;
    let activeHighResUrl = "";
    let hiResImageObject = null;
    let blurTimerFinished = false; // New flag for the 500ms minimum
    let hiResReady = false; // Controls the CSS class for the fade

    let lyrics = [{ t: 0, text: "♪ (Music) ♪" }];

    // PRIORITY 3 & 4: High-Res Image & Lyrics (Updated with 500ms Minimum Blur)
    function checkReveal(aId) {
        if (currentAlbumId === aId && activeHighResUrl && blurTimerFinished) {
            // We add a tiny 50ms buffer. This gives Svelte and the browser 
            // just enough time to apply the new src to the DOM invisibly 
            // before we trigger the CSS fade-in. This prevents the flash.
            setTimeout(() => {
                if (currentAlbumId === aId) hiResReady = true;
            }, 50);
        }
    }

    $: if (track && isOpen) {
        const aId = album ? album.id : 'unknown';
        
        // Only trigger the blur sequence if the album actually changed
        if (aId !== currentAlbumId) {
            // --- ATOMIC RESET ---
            currentAlbumId = aId;
            currentTrackIdForLyrics = track.id;
            
            hiResReady = false;        // 1. Instantly hides high-res (thanks to new CSS)
            blurTimerFinished = false; // 2. Reset the 500ms lock
            activeHighResUrl = "";     // 3. Clear URL (safe because opacity is instantly 0)

            // Start the minimum 500ms "Blur Lock"
            setTimeout(() => {
                if (currentAlbumId === aId) {
                    blurTimerFinished = true;
                    checkReveal(aId);
                }
            }, 500);

            if (album?.coverPath) {
                const hiRes = `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&v=${$appSessionVersion}&quality=${$isLowQualityImages ? 'low' : 'high'}`;
                
                const img = new Image();
                img.onload = () => {
                    if (currentAlbumId === aId) {
                        activeHighResUrl = hiRes;
                        checkReveal(aId);
                    }
                };
                img.src = hiRes;
            } else {
                activeHighResUrl = DEFAULT_PLACEHOLDER;
                checkReveal(aId);
            }
            triggerLyricsFetch(track);
        } 
        // If it's the SAME album but a DIFFERENT track, skip the blur entirely
        else if (track.id !== currentTrackIdForLyrics) {
            currentTrackIdForLyrics = track.id;
            triggerLyricsFetch(track);
        }
    }

    // --- DIAGNOSTICS STATE ---
    let showDiagnostics = false;
    let diagData = {};

    const openDiagnostics = () => {
        diagData = getAudioDiagnostics();
        
        // Scrape hardware network data if the browser supports it
        if (navigator.connection) {
            diagData.networkType = navigator.connection.effectiveType || 'Unknown';
            diagData.downlink = navigator.connection.downlink ? `${navigator.connection.downlink} Mbps` : 'Unknown';
            diagData.rtt = navigator.connection.rtt ? `${navigator.connection.rtt} ms` : 'Unknown';
        } else {
            diagData.networkType = 'Unsupported by browser';
            diagData.downlink = 'N/A';
            diagData.rtt = 'N/A';
        }
        
        showDiagnostics = true;
    };

    function triggerLyricsFetch(t) {
        if (!t) return;
        lyrics = [{ t: 0, text: "♪ (Loading...) ♪" }];
        const cid = t.id;
        const artistName = t.album?.artist?.name || $albumsMap.get(t.albumId)?.artistName || 'Unknown Artist';
        
        fetchLyricsOnFrontend(cid, artistName, t.title)
            .then(data => {
                if (track.id !== cid) return;
                lyrics = (data && data.length > 0) ? data : [{ t: 0, text: "♪ (Instrumental) ♪" }];
            })
            .catch(() => {
                if (track.id !== cid) return;
                lyrics = [{ t: 0, text: "♪ (Lyrics Unavailable) ♪" }];
            });
    }

    $: effectiveLyricIdx = (() => {
        const time = (isSeekingBar && pendingSeekTime !== null) ? pendingSeekTime : $playerCurrentTime;
        if (!lyrics || lyrics.length === 0) return -1;
        if (time < lyrics[0].t) return -1;
        return lyrics.findLastIndex(l => time >= l.t);
    })();

    $: if (lyricsScrollEl && effectiveLyricIdx >= 0) {
        if (isSeekingBar) {
            const activeLine = lyricsScrollEl.querySelectorAll('.lyric-line')[effectiveLyricIdx];
            if (activeLine) {
                lyricsScrollEl.scrollTo({ top: activeLine.offsetTop - lyricsScrollEl.clientHeight / 2 + activeLine.clientHeight / 2, behavior: 'auto' });
            }
        } else if (!isUserScrolling && effectiveLyricIdx !== lastScrolledIdx) {
            lastScrolledIdx = effectiveLyricIdx;
            const activeLine = lyricsScrollEl.querySelectorAll('.lyric-line')[effectiveLyricIdx];
            if (activeLine) {
                lyricsScrollEl.scrollTo({ top: activeLine.offsetTop - lyricsScrollEl.clientHeight / 2 + activeLine.clientHeight / 2, behavior: 'smooth' });
            }
        }
    }

    $: hasSyncLyrics = lyrics.length > 0 &&
                       lyrics[0].text !== "◆ LYRICS SYNC NOT AVAILABLE ◆" &&
                       lyrics[0].text !== "♪ (Instrumental / No text) ♪" &&
                       lyrics[0].text !== "♪ (Loading...) ♪" &&
                       lyrics[0].text !== "♪ (Lyrics Unavailable) ♪" &&
                       lyrics[0].text !== "♪ (Text not available) ♪" &&
                       lyrics[0].text !== "♪ (Instrumental) ♪" &&
                       lyrics[0].text !== "♪ (Music) ♪" &&
                       lyrics[0].text !== "♪";
</script>

<svelte:window
    bind:innerWidth={innerWidth}
    on:mousemove={onSeekMove}
    on:mouseup={onSeekEnd}
    on:touchmove|nonpassive={onSeekMove}
    on:touchend={onSeekEnd}
    on:keydown={handleGlobalKeyDown}
/>

{#if isOpen}
    <div 
        class="player-transition-wrapper" 
        style="position: fixed; inset: 0; z-index: 9990; pointer-events: none;"
        in:fly={{ y: '100%', duration: 550, easing: quintOut, opacity: 1 }}
        out:fly={{ y: '100%', duration: isClosingByDrag ? 15 : 350, easing: isClosingByDrag ? linear : expoIn, opacity: 1 }}
    >
        <div
            id="full-player"
            bind:this={playerEl}
            class:max-glass={$isMaxGlassActive}
            class:no-scroll={showQueue}
            class:is-dragging={isDragging}
            class:is-closing={isClosing}
            style="transform: translate3d(0, {dragY}px, 0); pointer-events: auto;"
        >
            
            {#if isVisEnabled}
                <div class="visualizer-bg" use:threeVisualizer></div>
            {/if}

            <div 
                class="drag-zone" 
                role="presentation" 
                on:touchstart={onTouchStart} 
                on:touchmove|preventDefault|nonpassive={onTouchMove} 
                on:touchend={onTouchEnd}
            >
                <div class="fp-drag-handle" on:click={handleClose} role="button" tabindex="0">
                    <div class="ios-handle" class:dragged={isDragging && dragY > 10}>
                        <div class="ios-handle-left"></div>
                        <div class="ios-handle-right"></div>
                    </div>
                </div>
                
                <div class="fp-header">
                    <span class="fp-header-title">NOW PLAYING</span>
                    <button class="btn-icon" style="padding: 0; margin-top: -10px; opacity: 0.5;" on:click={openDiagnostics} aria-label="Diagnostics">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="16" x2="12" y2="12"></line>
                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
                    </button>
                </div>
            </div>

            <div class="fp-scroll-content">
                
                <div class="fp-cover-container" class:shrink={hasSyncLyrics && !coverClick} on:click={handleCoverClick} role="button" tabindex="0">
                    
                    <div class="sober-cover-wrapper">
                        <img 
                            class="sober-cover low-res" 
                            src={lowResCoverUrl} 
                            alt="" 
                            on:error={handleImageError} 
                        />
                        
                        <img 
                            class="sober-cover high-res" 
                            class:is-visible={hiResReady}
                            src={activeHighResUrl} 
                            alt="" 
                        />
                    </div>
                    
                    {#if showHeartAnim}
                        <div class="heart-anim-overlay" in:scale={{duration: 200, easing: expoOut, start: 0.5}} out:fade={{duration: 300}}>
                            <svg viewBox="0 0 24 24" fill={isFavorite ? "#eeeeee" : "white"} stroke={isFavorite ? "#eeeeee" : "white"} stroke-width="2">
                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                            </svg>
                        </div>
                    {/if}
                </div>

                {#if hasSyncLyrics}
                    <div transition:slide={{duration: 400}}>
                        <div class="lyrics-spawn-container">
                            <div 
                                class="lyrics-preview-window" 
                                on:click={() => isLyricsFullScreen = true} 
                                role="button" 
                                tabindex="0"
                            >
                                <div class="lyrics-preview-strip" style="transform: translate3d(0, calc({-effectiveLyricIdx} * 24px), 0);">
                                    {#each lyrics as line, i}
                                        <div 
                                            class="lp-mini-line" 
                                            class:active={i === effectiveLyricIdx}
                                            style="font-size: {getDynamicFontSize(line.text, i === effectiveLyricIdx)}"
                                        >
                                            {line.text}
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        </div>
                    </div>
                {/if}

                <div class="fp-info">
                    <div class="fp-text-container">
                        <div 
                            class="fp-title marquee"
                            role="button" 
                            tabindex="0" 
                            on:click={goAlbum} 
                            on:keydown={(e) => e.key === 'Enter' && goAlbum()}
                        >
                            {track ? track.title : '---'}
                        </div>
                        <div 
                            class="fp-artist" 
                            role="button" 
                            tabindex="0" 
                            on:click={goArtist} 
                            on:keydown={(e) => e.key === 'Enter' && goArtist()}
                        >
                            {album ? album.artistName : '---'}
                        </div>
                    </div>
                    <button class="btn-icon" aria-label="Queue" on:click={() => showQueue = true}>
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="6" y="5" width="12" height="6" rx="3" />
                            <line x1="6" y1="15" x2="18" y2="15"></line>
                            <line x1="6" y1="19" x2="18" y2="19"></line>
                        </svg>
                    </button>
                </div>

                <div class="fp-progress-section">
                    <span class="time-label" bind:this={currentTimeRef}>0:00</span>
                    <div 
                        class="fp-progress-container" 
                        bind:this={progressContainerEl} 
                        on:mousedown={onSeekStart} 
                        on:touchstart|nonpassive={onSeekStart}
                    >
                        <div class="fp-progress-track" class:is-buffering={$isBuffering}>
                            <div class="fp-buffer-bar" bind:this={bufferRef}></div>
                            <div class="fp-progress-bar" bind:this={progressRef}></div>
                        </div>
                    </div>
                    <span class="time-label">{formatTime($playerDuration)}</span>
                </div>

                <div class="fp-controls">
                    <button aria-label="Shuffle" class="btn-icon" class:active={$isShuffle} on:click={() => isShuffle.set(!$isShuffle)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg>
                    </button>
                    <button aria-label="Back" class="btn-icon" on:click={playPrev}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" x2="5" y1="19" y2="5"></line></svg>
                    </button>
                    
                    <button aria-label="Play/Pause" class="fp-btn-main" on:click={togglePlay}>
                        {#if $isPlaying}
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                <rect width="4" height="16" x="7" y="4" rx="1" />
                                <rect width="4" height="16" x="13" y="4" rx="1" />
                            </svg>                        
                        {:else}
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        {/if}
                    </button>

                    <button aria-label="Next" class="btn-icon" on:click={playNext}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" x2="19" y1="5" y2="19"></line></svg>
                    </button>
                    <button aria-label="Repeat" class="btn-icon" class:active={$isRepeat} on:click={() => isRepeat.set(!$isRepeat)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"></path><path d="M3 11v-1a4 4 0 0 1 4-4h14"></path><path d="m7 22-4-4 4-4"></path><path d="M21 13v1a4 4 0 0 1-4 4H3"></path></svg>
                    </button>
                </div>

                <div class="fp-sliders">
                    <div class="preset-scroll">
                        <button class="preset-chip" 
                                class:active={$eqPreset === 'Custom'} 
                                on:click={() => eqPreset.set('Custom')} 
                                on:mousemove={handlePresetMouseMove}>
                            Custom
                        </button>
                        {#each Object.keys(presets) as p}
                            <button class="preset-chip" 
                                    class:active={$eqPreset === p} 
                                    on:click={() => applyPreset(p)} 
                                    on:mousemove={handlePresetMouseMove}>
                                {p}
                            </button>
                        {/each}
                    </div>

                    {#each [60, 250, '1K', '4K', '8K', '14K'] as freq, i}
                        <div class="fp-slider-row">
                            <span class="label-freq">{freq}</span>
                            <input class="sleek-slider" type="range" min="-12" max="12" step="0.1" 
                                value={$eqBands[i]} 
                                on:input={(e) => handleEqChange(i, e)} 
                                style="--val: {(( $eqBands[i] + 12) / 24) * 100}%">
                        </div>
                    {/each}
                </div>

                <div class="full-lyrics-card">
                    <div class="lyrics-header-row">
                        <h3>Lyrics</h3>
                        <button class="btn-icon" on:click={() => isLyricsFullScreen = true}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
                        </button>
                    </div>

                    <div class="lyrics-scroll-box" bind:this={lyricsScrollEl} on:wheel={handleUserScroll} on:touchmove={handleUserScroll}>
                        {#each lyrics as line, i}
                            <div class="lyric-line" class:active={i === effectiveLyricIdx} on:click={() => { activePlayer.currentTime = line.t; }}>
                                {line.text}
                            </div>
                        {/each}
                    </div>
                </div>

                <div class="artist-profile-card" on:click={goArtist} role="button" tabindex="0">
                    {#key artistImageUrl}
                        <img class="artist-bg-img" src={artistImageUrl} alt="Artist" on:error={handleImageError} />
                    {/key}
                    <div class="artist-frosted-overlay">
                        <span class="artist-name">{album ? album.artistName : 'Unknown Artist'}</span>
                        <div class="artist-stats-row">
                            <div class="stats-left">
                                <span class="artist-stats-text">1,234,567 monthly listeners</span>
                                <span class="dot">•</span>
                                <span class="artist-stats-text">{track?.playCount || 0} listens</span>
                            </div>
                            <span class="kbps-badge">{track?.bitrate || "???"} kbps</span>
                        </div>
                    </div>
                </div>
                </div>

            {#if showQueue}
            <div class="queue-modal" in:fly={{y: '100%', duration: 400, easing: expoOut}} out:fly={{y: '100%', duration: 300, easing: expoIn}}>
                <div class="queue-header">
                    <h3 class="queue-title">Playing Next</h3>
                    <button class="btn-icon" on:click={() => showQueue = false}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                
                <div class="queue-list">
                    {#each $currentPlaylist as t, i}
                        <div class="queue-item" class:active={i === $currentIndex} role="button" tabindex="0" on:click={() => { currentIndex.set(i); }}>
                            <div class="queue-index-col">
                                {#if i === $currentIndex}
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                {:else}
                                    <span class="queue-index">{i + 1}</span>
                                {/if}
                            </div>

                            <div class="queue-text">
                                <span class="queue-item-title" style={i === $currentIndex ? 'color: white;' : ''}>{t.title}</span>
                                <span class="queue-item-artist">{$albumsMap.get(t.albumId)?.artistName || 'Unknown Artist'}</span>
                                
                                {#if activeDownloads[t.id] !== undefined}
                                   <div class="queue-dl-status-row" transition:fade={{duration: 200}}>
                                        <div class="queue-dl-track-container">
                                            <div class="queue-dl-bar" style="transform: scaleX({activeDownloads[t.id] / 100})"></div>
                                        </div>

                                        <div class="queue-dl-label-wrapper" 
                                            in:fly={{ y: 4, duration: 500, delay: 500, easing: expoOut }}>
                                            <span class="queue-dl-label">
                                                {#if activeDownloads[t.id] < 100}
                                                    DOWNLOADING {Math.round(activeDownloads[t.id])}%
                                                {:else}
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                                    AVAILABLE OFFLINE
                                                {/if}
                                            </span>
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}

        </div>
        </div>

    {#if isLyricsFullScreen}
        <div class="lyrics-modal-popup" use:portal={true} in:fly={{y: '100%', duration: 400, easing: expoOut}} out:fly={{y: '100%', duration: 200, easing: expoIn}}>
            <div class="lyrics-modal-header">
                <h3 class="modal-title">Lyrics</h3>
                <button class="btn-icon" on:click={() => isLyricsFullScreen = false}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="lyrics-scroll-box popup-version" bind:this={lyricsScrollEl} on:wheel={handleUserScroll} on:touchmove={handleUserScroll}>
                {#each lyrics as line, i}
                    <div class="lyric-line" class:active={i === effectiveLyricIdx} on:click={() => { activePlayer.currentTime = line.t; }}>
                        {line.text}
                    </div>
                {/each}
            </div>
        </div>
    {/if}
{/if}

{#if showDiagnostics}
        <div class="lyrics-modal-popup" style="z-index: 9999999999;" use:portal={true} in:fly={{y: '100%', duration: 400, easing: expoOut}} out:fly={{y: '100%', duration: 200, easing: expoIn}}>
            <div class="lyrics-modal-header">
                <h3 class="modal-title">Engine Diagnostics</h3>
                <button class="btn-icon" on:click={() => showDiagnostics = false}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="lyrics-scroll-box" style="padding: 24px; text-align: left; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: rgba(255,255,255,0.7); line-height: 1.8;">
                
                <div style="margin-bottom: 12px; padding: 12px; background: rgba(0,0,0,0.4); border-radius: 8px; border-left: 3px solid #60a5fa;">
                    <strong style="color: #fff;">Network Profile:</strong><br>
                    Connection: <span style="color: {diagData.networkType === '4g' || diagData.networkType === 'wifi' ? '#4ade80' : '#f87171'}">{diagData.networkType}</span><br>
                    Bandwidth: <span style="color: #38bdf8">{diagData.downlink}</span><br>
                    Latency (RTT): <span style="color: {parseInt(diagData.rtt) < 150 ? '#4ade80' : '#f87171'}">{diagData.rtt}</span>
                </div>

                <div style="margin-bottom: 12px; padding: 12px; background: rgba(0,0,0,0.4); border-radius: 8px; border-left: 3px solid var(--accent-color);">
                    <strong style="color: #fff;">WebAudio Pipeline:</strong><br>
                    Engine Mode: <span style="color: {diagData.mode === 'WebAudio API' ? '#c084fc' : '#facc15'}">{diagData.mode}</span><br>
                    AudioCtx State: <span style="color: {diagData.ctxState === 'running' ? '#4ade80' : (diagData.ctxState === 'suspended' ? '#facc15' : '#f87171')}">{diagData.ctxState}</span><br>
                    Track Load ID: <span style="color: #cbd5e1">{track?.id || 'None'}</span><br>
                    UI Buffering Flag: <span style="color: {$isBuffering ? '#f87171' : '#4ade80'}">{$isBuffering.toString().toUpperCase()}</span>
                </div>

                <div style="margin-bottom: 12px; padding: 12px; background: rgba(0,0,0,0.4); border-radius: 8px; border-left: 3px solid #fbbf24;">
                    <strong style="color: #fff;">Decoder & Cache:</strong><br>
                    Current Track Decoded: <span style="color: {diagData.bufferDecoded ? '#4ade80' : '#f87171'}">{diagData.bufferDecoded ? 'READY' : 'WAITING'}</span><br>
                    Active Decodes: <span style="color: {diagData.activeDecodes > 0 ? '#fbbf24' : '#a3a3a3'}">{diagData.activeDecodes} Threads</span><br>
                    Decoded Buffer Cache: <span style="color: #38bdf8">{diagData.cacheSize} / 5</span>
                </div>

                <div style="padding: 12px; background: rgba(0,0,0,0.4); border-radius: 8px; border-left: 3px solid #34d399;">
                    <strong style="color: #fff;">MSE Network Stream:</strong><br>
                    Stream Complete: <span style="color: {diagData.mseFetchComplete ? '#4ade80' : '#fbbf24'}">{diagData.mseFetchComplete ? 'YES' : 'STREAMING...'}</span><br>
                    Bytes Downloaded: <span style="color: #38bdf8">{(diagData.mseLoadedBytes / 1024 / 1024).toFixed(2)} MB</span><br>
                    MSE ReadyState: <span style="color: {diagData.mseReadyState === 'open' ? '#4ade80' : '#facc15'}">{diagData.mseReadyState}</span><br>
                    MSE Connected to Output: <span style="color: {diagData.mseWired ? '#4ade80' : '#f87171'}">{diagData.mseWired ? 'YES' : 'NO'}</span><br><br>

                    <strong style="color: #fff;">HTML5 Background Keep-Alive:</strong><br>
                    <span style="color: #a3a3a3">{diagData.html5Status}</span>
                </div>
            </div>
        </div>
    {/if}

<style>
   /* --- NEW VISUALIZER STYLES --- */
    .visualizer-bg {
        position: absolute;
        inset: 0;
        width: 100%; /* Safety fallback for sizing issues */
        height: 100%;
        z-index: -1; 
        pointer-events: none;
        opacity: 0.6;
        mix-blend-mode: screen; 
        border-radius: inherit; 
        overflow: hidden; 
        /* Smooth fade out on all edges so it seamlessly blends into the app */
        -webkit-mask-image: radial-gradient(ellipse at center, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 85%);
        mask-image: radial-gradient(ellipse at center, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 85%);
    }

    .drag-zone, .fp-scroll-content {
        position: relative;
        z-index: 1; /* Elevate UI above the Three.js canvas */
    }
    /* ----------------------------- */

    /* --- ARTIST PROFILE CARD --- */
    .artist-profile-card {
        position: relative;
        height: 350px; 
        border-radius: 28px;
        margin-top: 24px;
        cursor: pointer;
        overflow: hidden; /* Clips everything inside */
        
        /* FIX 1: Remove solid background. Use a dark semi-transparent fill 
        to ensure the browser doesn't "occlude" the layers underneath. */
        background: rgba(17, 17, 17, 0.01); 
        
        /* FIX 2: Force a new composite layer for the entire card */
        transform: translateZ(0);
        -webkit-transform: translateZ(0);
    }

    .artist-bg-img {
        position: absolute;
        inset: 0; /* Shorthand for top/left/right/bottom: 0 */
        width: 100%;
        height: 100%;
        object-fit: cover;
        z-index: 1; /* Lowest layer */
        transform: scale(1.05);
    }

    /* --- THE FROSTED OVERLAY --- */
    .artist-frosted-overlay {
        position: absolute;
        left: 0;
        bottom: 0;
        width: 100%;
        height: 35%; 
        z-index: 2; /* Sits above image */
        
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 0 24px;
        box-sizing: border-box;
        
        /* FIX 3: Gradient must be semi-transparent to see the blur */
        background: linear-gradient(
            to bottom, 
            rgba(255, 255, 255, 0.1) 0%, 
            rgba(0, 0, 0, 0.7) 100%
        );
        
        /* Important: Hide overflow so the blur pseudo-element doesn't leak */
        overflow: hidden;
        border-bottom-left-radius: 28px;
        border-bottom-right-radius: 28px;
    }

    /* FIX 4: The actual Blur Layer (Pseudo-element) */
    .artist-frosted-overlay::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: -1; /* Behind the text, but inside the overlay */
        
        /* The Blur */
        backdrop-filter: blur(20px) saturate(160%);
        -webkit-backdrop-filter: blur(20px) saturate(160%);
        
        /* FIX 5: Force hardware acceleration on the blur specifically */
        will-change: backdrop-filter;
    }

    .artist-name {
        font-size: 26px;
        font-weight: 900;
        color: white;
        margin-bottom: 6px;
        text-shadow: 0 2px 15px rgba(0,0,0,0.5);
        letter-spacing: -0.5px;
    }

    .artist-stats-row {
        display: flex;
        justify-content: space-between; /* Pushes kbps to the right */
        align-items: center;
        width: 100%;
    }

    .stats-left {
        display: flex;
        align-items: center;
        gap: 2px;
    }

    .artist-stats-text {
        font-size: 9px;
        color: rgba(255, 255, 255, 0.8);
        font-weight: 600;
        white-space: nowrap;
    }

    .dot {
        margin: 0 6px;
        color: rgba(255, 255, 255, 0.4);
        font-size: 14px;
    }

    .kbps-badge {
        background: rgba(255, 255, 255, 0.5);
        padding: 4px 10px;
        margin-left: 10px;
        border-radius: 8px;
        font-size: 8px;
        font-family: 'JetBrains Mono', monospace; /* Modern tech look */
        font-weight: 800;
        color: rgba(0, 0, 0, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.1);
        text-transform: uppercase;
        box-shadow: 0 4px 10px rgba(0,0,0,0.2);
    }

    .heart-anim-overlay {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100px;
        height: 100px;
        pointer-events: none;
        z-index: 10;
        filter: drop-shadow(0 10px 15px rgba(0,0,0,0.5));
    }

    .heart-anim-overlay svg {
        width: 100%;
        height: 100%;
    }

    #full-player {
        --fp-offset: 18px;
        --base-header-height: 64px;
        --base-footer-height: 80px;

        --fp-height-top: calc(var(--base-header-height) + var(--fp-offset));
        --fp-height-bottom: calc(var(--base-footer-height) - var(--fp-height-top));

        position: fixed !important;
        top: var(--fp-height-top) !important; 
        bottom: var(--fp-height-bottom) !important;
        right: 0 !important; 
        left: auto !important;
        width: 420px !important; 
        max-width: 100vw !important;
        height: calc(100dvh - 144px) !important;
        display: flex !important; 
        flex-direction: column !important;
        color: white !important;
        overflow: hidden !important; 
        isolation: isolate !important;
        will-change: transform;
        -webkit-backface-visibility: hidden;
        backface-visibility: hidden;
        background: linear-gradient(to bottom, rgba(255,255,255,0.08) 0%, transparent 15%),
                    linear-gradient(to bottom, rgba(0,0,0,0.45), rgba(0,0,0,0.9)),
                    var(--accent-color) !important;
        backdrop-filter: blur(50px) saturate(210%) brightness(1.1) !important;
        -webkit-backdrop-filter: blur(50px) saturate(210%) brightness(1.1) !important;

        /* FIX: Prevents text and UI highlighting on repeated fast clicks */
        user-select: none;
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
    }

    #full-player.is-dragging { transition: none !important; }

    #full-player:not(.is-dragging) {
        transition: transform 0.4s cubic-bezier(0.3, 0, 0.1, 1),
                    backdrop-filter 0.4s ease,
                    -webkit-backdrop-filter 0.4s ease;
    }

    #full-player.is-closing {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        background: transparent !important;
        opacity: 0.9;
        transition: none !important;
    }

    #full-player.max-glass { 
        height: calc(100dvh - 220px) !important; 
        top: 80px; 
        right: 16px !important; 
        border-radius: 32px !important; 
        border: 1px solid rgba(255, 255, 255, 0.2) !important; 
        box-shadow: 0 25px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1) !important;
    }

    .drag-zone { 
        touch-action: none !important; 
        flex-shrink: 0; 
        padding: 16px 24px 0 24px; 
        cursor: grab;
    }
    .drag-zone:active { cursor: grabbing; }

    #full-player.no-scroll .fp-scroll-content { overflow: hidden !important; }

    .fp-scroll-content {
        width: 100%; flex: 1; overflow-y: auto; overflow-x: hidden;
        padding: 0 24px 32px 24px; box-sizing: border-box;
        scrollbar-width: none; -ms-overflow-style: none;
    }
    .fp-scroll-content::-webkit-scrollbar { display: none; }

    .fp-drag-handle { 
        display: flex; 
        width: 100%;
        justify-content: center;
        align-items: center;
        margin-bottom: 4px;
        padding: 8px 0;
        outline: none;
    }
    .ios-handle {
        display: flex;
        width: 40px;
        height: 24px;
        justify-content: center;
        align-items: center;
        cursor: pointer;
    }
    .ios-handle-left, .ios-handle-right {
        width: 20px;
        height: 5px;
        background: rgba(255, 255, 255, 0.3);
        transition: transform 0.2s ease, background 0.2s ease;
    }
    .ios-handle-left {
        border-radius: 3px 0 0 3px;
        transform-origin: center right;
    }
    .ios-handle-right {
        border-radius: 0 3px 3px 0;
        transform-origin: center left;
    }
    .ios-handle.dragged .ios-handle-left { transform: rotate(15deg); }
    .ios-handle.dragged .ios-handle-right { transform: rotate(-15deg); }

    .queue-modal {
        position: absolute; inset: 0; z-index: 100000;
        background: rgba(15, 15, 15, 0.95);
        backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
        display: flex; flex-direction: column; border-radius: inherit;
        width: 100%;
    }
    .queue-header { padding: 32px 24px 16px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .queue-title { margin: 0; font-size: 18px; color: white; font-weight: 800; letter-spacing: -0.5px; }
    
    .queue-list { flex: 1; overflow-y: auto; padding: 16px 24px 40px 24px; display: flex; flex-direction: column; gap: 4px; }
    .queue-list::-webkit-scrollbar { display: none; }
    
    .queue-item { display: flex; align-items: center; gap: 16px; padding: 12px; border-radius: 12px; cursor: pointer; transition: background 0.2s; }
    .queue-item:hover { background: rgba(255,255,255,0.05); }
    .queue-item.active { background: rgba(255,255,255,0.08); }
    .queue-index { width: 16px; text-align: center; font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.3); }
    
    .queue-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .queue-item-title { font-weight: 600; font-size: 15px; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
    .queue-item-artist { font-size: 13px; color: rgba(255,255,255,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .queue-dl-status-row {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        margin-top: 8px;
        height: 16px;
    }

    .queue-dl-label-wrapper {
        position: relative;
        z-index: 2;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 0 24px; 
        
        background: linear-gradient(
            90deg, 
            transparent 0%, 
            #0f0f0f 10%, 
            #0f0f0f 90%, 
            transparent 100%
        );

        will-change: transform, opacity;
    }

    .queue-dl-label {
        font-size: 8px;
        font-weight: 900;
        letter-spacing: 0.1em;
        color: rgba(255, 255, 255, 0.9);
        display: flex;
        align-items: center;
        gap: 4px;
        text-transform: uppercase;
        white-space: nowrap;
    }

    .queue-dl-track-container {
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        height: 3px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        overflow: hidden;
        z-index: 1;
    }

    .queue-dl-bar {
        height: 100%;
        width: 100%;
        background: rgba(255, 255, 255, 0.5);
        transform-origin: left;
        transition: transform 0.4s cubic-bezier(0.32, 0.72, 0, 1);
        will-change: transform;
    }

    .queue-item {
        padding: 16px 12px;
    }

    .queue-dl-status-row:hover .queue-dl-track-container {
        height: 4px;
        background: rgba(255, 255, 255, 0.2);
        transition: height 0.3s ease;
    }

    .lyrics-modal-popup {
        position: fixed; inset: 0;
        background: rgba(15, 15, 15, 0.95);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        display: flex; flex-direction: column;
        z-index: 999999999;
    }
    .lyrics-modal-header { padding: max(48px, env(safe-area-inset-top)) 24px 16px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .modal-title { margin: 0; font-size: 18px; color: white; font-weight: 800; letter-spacing: -0.5px; }

    .popup-version { padding: 40px 24px !important; align-items: center; text-align: center; }
    .popup-version .lyric-line { font-size: 24px; margin-bottom: 24px; transform-origin: center; }
    .popup-version .lyric-line.active { font-size: 36px; }

    @keyframes iosPremiumSpawn {
        0% {
            opacity: 0;
            transform: translate3d(0, 16px, 0) scale(0.96);
        }
        100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
        }
    }

    .lyrics-spawn-container {
        padding-bottom: 16px; 
        animation: iosPremiumSpawn 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        will-change: transform, opacity;
    }

    .lyrics-preview-window {
        height: 72px; 
        overflow: hidden; 
        position: relative;
        cursor: pointer;
        -webkit-mask-image: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,1) 65%, transparent 100%);
        mask-image: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,1) 65%, transparent 100%);
        -webkit-mask-size: 100% 100%;
        -webkit-mask-repeat: no-repeat;
        -webkit-transform: translateZ(0);
        transform: translateZ(0);
    }

    .lyrics-preview-strip {
        width: 100%; transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1); padding-top: 24px;
    }

    .lp-mini-line {
        height: 24px; line-height: 24px; text-align: center; font-size: 8px; font-weight: 600;
        color: rgba(255, 255, 255, 0.3); transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 16px;
    }

    .lp-mini-line.active {
        color: white; font-weight: 800; text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
        transform: scale(1.05); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .fp-progress-track { 
        width: 100%; height: 4px !important; background: rgba(255,255,255,0.15) !important; 
        border-radius: 10px !important; position: relative; overflow: hidden; 
        transition: height 0.3s cubic-bezier(0.32, 0.72, 0, 1), background 0.2s !important; transform: translateZ(0); 
    }
    .fp-progress-container:hover .fp-progress-track { height: 40% !important; background: rgba(255,255,255,0.2) !important; }
    
    /* NEW: Styled smooth buffer bar */
    .fp-buffer-bar {
        position: absolute;
        top: 0; left: 0;
        height: 100%; width: 100%;
        background: rgba(255, 255, 255, 0.35); /* Visible under the main progress bar */
        transform-origin: left;
        will-change: transform;
        transform: scaleX(0);
        z-index: 0;
    }

    .fp-progress-bar {
        position: relative; /* Elevated above buffer bar */
        z-index: 1;
        height: 100%; width: 100% !important; background: white !important;
        transform-origin: left; will-change: transform; transform: translateZ(0) scaleX(0);
        transition: background 0.2s;
    }

    .fp-progress-bar {
        height: 100%; width: 100% !important; background: white !important;
        transform-origin: left; will-change: transform; transform: translateZ(0) scaleX(0);
        transition: background 0.2s;
    }

    .time-label {
        color: rgba(255,255,255,0.7); font-size: 11px; width: 42px; text-align: center;
        font-variant-numeric: tabular-nums; transform: translateZ(0); will-change: contents;
    }

    .preset-scroll {
        display: flex; gap: 8px; overflow-x: auto; border-bottom: 1px solid rgba(255,255,255,0.05);
        padding: 8px 14px !important; margin: -8px -4px 12px -4px !important; align-items: center;
    }
    .preset-scroll::-webkit-scrollbar { display: none; }
    
    .preset-chip {
        flex-shrink: 0; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); 
        color: rgba(255,255,255,0.7); padding: 6px 14px; border-radius: 16px; font-size: 11px; 
        font-weight: 700; cursor: pointer; 
        position: relative;
        overflow: hidden;
        -webkit-tap-highlight-color: transparent; 
        transition: background 0.3s ease, box-shadow 0.3s ease, filter 0.3s ease,
                    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.3s ease, border-color 0.3s ease;
    }

    .preset-chip::after {
        content: ""; position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: radial-gradient(circle at var(--m-x) var(--m-y), rgba(255, 255, 255, 0.25), transparent 70%);
        opacity: 0; transition: opacity 0.4s ease; pointer-events: none; z-index: 0;
    }

    .preset-chip:hover::after { opacity: 1; }
    .preset-chip:hover {
        background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.2);
        box-shadow: 0 0 30px rgba(255, 255, 255, 0.1), inset 0 0 10px rgba(255, 255, 255, 0.1); filter: brightness(1.2);
    }
    .preset-chip:active { transform: scale(0.94) !important; filter: brightness(0.9); transition: transform 0.1s ease; }
    .preset-chip.active { 
        background: white !important; color: black !important; border-color: white !important; 
        box-shadow: 0 0 15px rgba(255,255,255,0.4) !important; transform: scale(1.05) !important; filter: brightness(1) !important; 
    }
    .preset-chip.active::after { display: none; }

    .fp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; margin-top: -10px; min-height: 20px; }
    .fp-header-title { font-size: 12px; font-weight: 600; letter-spacing: 1px; color: rgba(255,255,255,0.9); padding-bottom: 10px;}
    .close-btn { background: none; border: none; color: rgba(255,255,255,0.9); cursor: pointer; padding: 8px; border-radius: 50%; transition: background 0.2s; }
    .close-btn:hover { background: rgba(255,255,255,0.1); }

    .fp-cover-container { 
        position: relative;
        display: flex; 
        align-items: center; 
        justify-content: center; 
        width: 100%; 
        max-width: 350px; 
        margin: 0 auto 24px auto; 
        
        /* OPTIMIZATION: We moved the shadow and border HERE, away from the overflow:hidden wrapper */
        border-radius: 12px;
        box-shadow: 0 15px 40px rgba(0,0,0,0.5);
        border: 1px solid rgba(255,255,255,0.1);
        
        /* OPTIMIZATION: Use transform instead of max-width */
        transition: transform 0.4s cubic-bezier(0.25, 1, 0.5, 1),
                    margin-bottom 0.4s cubic-bezier(0.25, 1, 0.5, 1); 
        
        transform-origin: top center;
        will-change: transform;
        -webkit-transform: translate3d(0,0,0);
        transform: translate3d(0,0,0);
    }

    .fp-cover-container.shrink {
        /* Scale mathematically simulates shrinking to 262px, negative margin pulls the lyrics up */
        transform: scale(0.748) translate3d(0,0,0); 
        margin-bottom: -70px; 
    }

    /* --- NEW SOBER COVER SYSTEM (GPU OPTIMIZED) --- */
    .sober-cover-wrapper {
        position: relative;
        width: 100%;
        aspect-ratio: 1/1;
        background: #000; /* Pure black background prevents white flashes */
        border-radius: 12px;
        overflow: hidden;
        transform: translateZ(0); /* GPU acceleration */
    }

    .sober-cover {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .low-res {
        z-index: 1;
        filter: blur(15px) saturate(1.5); /* Deep blur */
        transform: scale(1.1); /* Prevents blurred edges from showing container background */
        transition: opacity 0.3s ease;
    }

    .high-res {
        z-index: 2;
        opacity: 0;
        /* INSTANT hide when the album changes (prevents the old cover from ghosting out) */
        transition: opacity 0s;
        will-change: opacity;
    }

    .high-res.is-visible {
        opacity: 1;
        /* VERY SMOOTH fade-in once the 500ms has passed and the new image is loaded */
        transition: opacity 1.2s cubic-bezier(0.22, 1, 0.36, 1);
    }

    /* Hardware optimized animation (Removed filter: brightness) */
    @keyframes iosInstallPopFast {
        0% {
            transform: scale(0.95);
            opacity: 0;
        }
        60% {
            transform: scale(1.02);
            opacity: 1;
        }
        100% {
            transform: scale(1);
            opacity: 1;
        }
    }

    .installed-pop {
        animation: iosInstallPopFast 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }

    .fp-info, 
    .fp-progress-section, 
    .fp-controls,
    .fp-sliders {
        transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
        will-change: transform;
        -webkit-backface-visibility: hidden;
        backface-visibility: hidden;
    }

    .fp-info { 
        display: flex; 
        justify-content: space-between; 
        align-items: center; 
        margin-bottom: 16px; 
        padding: 0;
    }

    .fp-info.enlarge,
    .fp-info.enlarge ~ .fp-progress-section,
    .fp-info.enlarge ~ .fp-controls,
    .fp-info.enlarge ~ .fp-sliders { 
        -webkit-transform: translate3d(0, 30px, 0);
        transform: translate3d(0, 30px, 0);
    }

    .fp-text-container { min-width: 0; flex: 1; display: flex; flex-direction: column; text-align: left; }
    .fp-title { font-size: 20px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: white; margin-bottom: 4px; cursor: pointer}
    .fp-artist { font-size: 14px; color: rgba(255,255,255,0.7); cursor: pointer; transition: color 0.2s; }
    .fp-artist:hover { color: white; text-decoration: underline; }

    .fp-progress-section { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .fp-progress-container { flex: 1; height: 24px; display: flex; align-items: center; cursor: pointer; position: relative; }

    .fp-controls { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; padding: 0 16px; }
    .btn-icon { background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; transition: color 0.2s; padding: 8px; }
    .btn-icon:hover { color: white; }
    .btn-icon.active { color: white; }

    .fp-btn-main { 
        width: 48px; height: 48px; border-radius: 50%; border: none; background: white; color: black; 
        display: flex; align-items: center; justify-content: center; cursor: pointer; position: relative; z-index: 1; 
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3), 0 0 5px 2px rgba(255, 255, 255, 0.6), 0 0 25px rgba(255, 255, 255, 0.2) !important; 
        transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.3s ease !important; 
    }
    .fp-btn-main:hover { 
        transform: scale(1.08) !important;
        box-shadow: 0 0 20px rgba(255, 255, 255, 0.4), 0 0 10px rgba(255, 255, 255, 0.2), 0 0 4px rgba(255, 255, 255, 0.1) !important; 
    }
    .fp-btn-main:active { transform: scale(0.96) !important; filter: brightness(0.9); }

    .fp-sliders { 
        padding: 16px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); margin-bottom: 24px;
        background: rgba(255, 255, 255, 0.04) !important; border: 1px solid rgba(255, 255, 255, 0.15) !important;
        border-radius: 28px !important; backdrop-filter: blur(40px) saturate(200%) brightness(1.1) !important;
        -webkit-backdrop-filter: blur(40px) saturate(200%) brightness(1.1) !important;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2) !important;
    }
    .fp-slider-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .label-accent { color: var(--accent-color, #ffffff) !important; width: 32px; font-size: 11px; text-align: right; }
    .label-freq { width: 32px; font-size: 11px; text-align: right; color: rgba(255,255,255,0.7); }
    
    .sleek-slider { 
        -webkit-appearance: none; appearance: none; flex: 1; height: 4px; border-radius: 2px; 
        background: linear-gradient(to right, var(--accent-color, #ffffff) var(--val), rgba(255,255,255,0.15) var(--val)) !important; 
        outline: none; transition: height 0.2s ease; transform: translateZ(0); cursor: grab;
    }
    .sleek-slider:active { cursor: grabbing; }

    .sleek-slider::-webkit-slider-thumb {
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
        -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: white; 
        cursor: pointer; box-shadow: 0 0 8px rgba(0,0,0,0.8);
    }
    .sleek-slider::-webkit-slider-thumb:hover { transform: scale(1.4); }
    .sleek-slider::-moz-range-thumb { 
        width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; border: none; box-shadow: 0 0 8px rgba(0,0,0,0.8); 
    }

    .full-lyrics-card { 
        padding: 24px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; flex-shrink: 0; height: 350px; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
        background: rgba(255, 255, 255, 0.04) !important; border: 1px solid rgba(255, 255, 255, 0.15) !important;
        border-radius: 28px !important; backdrop-filter: blur(40px) saturate(200%) brightness(1.1) !important;
        -webkit-backdrop-filter: blur(40px) saturate(200%) brightness(1.1) !important;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2) !important; 
    }
    .lyrics-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .lyrics-header-row h3 { margin: 0; font-size: 14px; color: var(--accent-color, #ffffff) !important; text-transform: uppercase; letter-spacing: 1px; font-weight: 800; }
    .lyric-line { font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.3); margin-bottom: 16px; transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1); transform-origin: left center; cursor: pointer; }
    .lyric-line:hover { color: rgba(255,255,255,0.6); }
    .lyric-line.active { color: white; font-size: 22px; font-weight: 800; text-shadow: 0 0 16px rgba(255,255,255,0.4); }

    .lyrics-scroll-box { flex: 1; overflow-y: auto; padding-right: 8px; display: flex; flex-direction: column; scroll-behavior: smooth; position: relative; scrollbar-width: none; -ms-overflow-style: none;}
    .lyrics-scroll-box::-webkit-scrollbar { display: none; }

    @media (max-width: 768px) {
        #full-player { 
            top: 60px !important; 
            bottom: 0 !important; 
            left: 0 !important; 
            right: 0 !important; 
            width: 100% !important; 
            max-width: 100% !important; 
            height: 100% !important; 
            min-height: 100dvh !important; 
            margin: 0 !important;
            border-left: none !important; 
            border-radius: 0 !important;
            z-index: 999999 !important; 
            padding-bottom: max(16px, env(safe-area-inset-bottom)) !important; 
        }
        .drag-zone { padding-top: max(16px, env(safe-area-inset-top)); }
        .close-btn { display: none; }
    }

    @keyframes buffer-wave {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
    }

    .is-buffering {
        position: relative;
        overflow: hidden !important; 
    }

    .is-buffering::after {
        content: "";
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
        animation: buffer-wave 1.2s infinite linear;
        z-index: 5;
        pointer-events: none;
    }
</style>