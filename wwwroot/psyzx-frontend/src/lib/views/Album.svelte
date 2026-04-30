<script>
    import { get } from "svelte/store";
    import { fade, scale } from "svelte/transition";
    import {
        albumsMap,
        currentPlaylist,
        currentIndex,
        isPlaying,
        isShuffle,
        isRepeat,
        shuffleHistory,
        shuffleFuture,
        userQueue,
        accentColor,
        isGlobalColorActive,
        isMaxGlassActive,
        appSessionVersion,
        isLowQualityImages,
    } from "../../store.js";
    import { formatTime } from "../utils.js";
    import { api } from "../api.js";
    import * as THREE from 'three';
    import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
    import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js';
    import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

    // 1. IMPORT ONLY WHAT IS NEEDED FROM THE NEW ENGINE
    import { unlockAudioContext, togglePlayGlobal } from "../audio.js";

    function portal(node) {
        document.body.appendChild(node);
        return {
            destroy() {
                if (node.parentNode) node.parentNode.removeChild(node);
            },
        };
    }

    export let albumId;

    $: album = $albumsMap.get(parseInt(albumId));
    $: tracks =
        album && album.tracks
            ? [...album.tracks].sort((a, b) => {
                  const discA = a.discNumber || 1;
                  const discB = b.discNumber || 1;
                  if (discA !== discB) return discA - discB;
                  if (a.trackNumber !== b.trackNumber && a.trackNumber > 0)
                      return a.trackNumber - b.trackNumber;
                  return a.title.localeCompare(b.title);
              })
            : [];

    $: discs = [...new Set(tracks.map((t) => t.discNumber || 1))].sort(
        (a, b) => a - b,
    );

    $: totalSeconds = tracks.reduce((sum, t) => sum + t.durationSeconds, 0);
    $: hrs = Math.floor(totalSeconds / 3600);
    $: mins = Math.floor((totalSeconds % 3600) / 60);
    $: timeString = hrs > 0 ? `${hrs} hr ${mins} min` : `${mins} min`;

    $: totalAlbumPlays = tracks.reduce((sum, t) => sum + (t.playCount || 0), 0);
    $: maxPlay = Math.max(...tracks.map((t) => t.playCount || 0));

    $: coverUrl =
        album && album.coverPath
            ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath.split('?')[0])}&v=${$appSessionVersion}&quality=${$isLowQualityImages ? "low" : "high"}`
            : DEFAULT_PLACEHOLDER;

    $: avgBitrate =
        tracks.length > 0
            ? Math.round(
                  tracks.reduce((s, t) => s + (t.bitrate || 0), 0) /
                      tracks.length,
              )
            : 0;

    $: isPlayingAlbum =
        $isPlaying &&
        $currentPlaylist.some((t) => tracks.find((pt) => pt.id === t.id));

    let albumColor = "#b534d1";

    const DEFAULT_PLACEHOLDER =
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=";
    const handleImageError = (ev) => {
        ev.target.src = DEFAULT_PLACEHOLDER;
    };

    const extractAlbumColor = async (url) => {
        if (typeof document === "undefined") return;
        if (!url) {
            albumColor = "#b534d1";
            return;
        }
        try {
            const res = await fetch(url, { credentials: "include" });
            if (!res.ok) throw new Error("Auth err");

            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                try {
                    const cvs = document.createElement("canvas");
                    cvs.width = 64;
                    cvs.height = 64;
                    const ctx = cvs.getContext("2d", {
                        willReadFrequently: true,
                    });
                    ctx.drawImage(img, 0, 0, 64, 64);
                    const [r, g, b] = ctx.getImageData(32, 32, 1, 1).data;
                    const boost = Math.max(r, g, b) < 40 ? 50 : 0;
                    albumColor = `rgb(${r + boost},${g + boost},${b + boost})`;
                } catch (e) {
                    albumColor = "#b534d1";
                }
                URL.revokeObjectURL(objUrl);
            };
            img.onerror = () => {
                albumColor = "#b534d1";
            };
            img.src = objUrl;
        } catch (e) {
            albumColor = "#b534d1";
        }
    };

    $: extractAlbumColor(coverUrl);

    let viewMode = "list";
    let mounted = false;
    import { onMount } from "svelte";
    import Artist from "./Artist.svelte";
    onMount(() => {
        setTimeout(() => (mounted = true), 50);
    });

    const togglePlayAlbum = () => {
        if (typeof window !== "undefined") {
            unlockAudioContext(); 
        }

        if (isPlayingAlbum) {
            togglePlayGlobal(); 
        } else {
            if (
                $currentPlaylist.some((t) =>
                    tracks.find((pt) => pt.id === t.id),
                )
            ) {
                togglePlayGlobal(); 
            } else {
                currentPlaylist.set(tracks);
                if ($isShuffle) {
                    shuffleHistory.set([]);
                    currentIndex.set(Math.floor(Math.random() * tracks.length));
                } else {
                    currentIndex.set(0);
                }
            }
        }
    };

    const toggleShuffleMode = () => {
        isShuffle.set(!$isShuffle);
        currentPlaylist.set(tracks);
        if ($isShuffle) {
            shuffleHistory.set([]);
            currentIndex.set(Math.floor(Math.random() * tracks.length));
        } else {
            currentIndex.set(0);
        }
    };

    const playSpecificTrack = (index) => {
        if (typeof window !== "undefined") {
            unlockAudioContext();
        }
        shuffleHistory.set([]);
        shuffleFuture.set([]);
        userQueue.set([]); 
        currentPlaylist.set(tracks);
        currentIndex.set(index);
    };

    let toastMessage = "";
    let toastTimeout;

    const showToast = (msg) => {
        toastMessage = msg;
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => (toastMessage = ""), 2500);
    };

    let isDownloading = false;

    const downloadAlbum = () => {
        if (
            album &&
            album.tracks &&
            "serviceWorker" in navigator &&
            navigator.serviceWorker.controller
        ) {
            isDownloading = true;
            const trackIds = album.tracks.map((t) => t.id);
            navigator.serviceWorker.controller.postMessage({
                type: "PRELOAD_TRACKS",
                trackIds: trackIds,
                ArtistId: album.artistId,
                coverPath: album.coverPath,
            });
            setTimeout(() => {
                isDownloading = false;
            }, 2000);
        }
    };

    let contextMenu = { show: false, x: 0, y: 0, track: null };

    const openContextMenu = (e, track) => {
        e.preventDefault(); 
        let x = e.clientX;
        let y = e.clientY;
        if (x + 220 > window.innerWidth) x -= 220;
        if (y + 180 > window.innerHeight) y -= 180;
        contextMenu = { show: true, x, y, track };
    };

    const closeContextMenu = () => {
        contextMenu.show = false;
    };

    const handleGlobalClick = () => {
        if (contextMenu.show) closeContextMenu();
    };

    const addToQueueContext = (track) => {
        userQueue.update((q) => [...q, track]);
        showToast("Added to Queue");
        closeContextMenu();
    };

    function swipeToQueue(node, track) {
        let startX = 0,
            startY = 0,
            currentX = 0,
            isSwiping = false,
            hasVibrated = false,
            blockSwipe = false;
        const bgLeft = node.parentElement.querySelector(".swipe-bg-left");
        const bgRight = node.parentElement.querySelector(".swipe-bg-right");

        const onStart = (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isSwiping = false;
            hasVibrated = false;
            blockSwipe = false;
            node.style.transition = "none";
            bgLeft.style.transition = "none";
            bgRight.style.transition = "none";
        };

        const onMove = (e) => {
            if (blockSwipe) return;

            let deltaX = e.touches[0].clientX - startX;
            let deltaY = e.touches[0].clientY - startY;

            if (!isSwiping && Math.abs(deltaY) > Math.abs(deltaX) * 0.8) {
                blockSwipe = true;
                return;
            }

            currentX = Math.max(-120, Math.min(120, deltaX));

            if (Math.abs(currentX) > 10) isSwiping = true;

            node.style.transform = `translate3d(${currentX}px, 0, 0)`;

            if (currentX > 0) {
                bgRight.style.width = "0px";
                bgLeft.style.width = `${currentX}px`;
                const icon = bgLeft.querySelector("svg");
                if (currentX > 60) {
                    bgLeft.style.backgroundColor = "#10b981";
                    if (icon) icon.style.transform = "scale(1.2)";
                    if (!hasVibrated) {
                        if (navigator.vibrate) navigator.vibrate(50);
                        hasVibrated = true;
                    }
                } else {
                    bgLeft.style.backgroundColor = "rgba(16, 185, 129, 0.4)";
                    if (icon) icon.style.transform = "scale(1)";
                    hasVibrated = false;
                }
            }
            else if (currentX < 0) {
                bgLeft.style.width = "0px";
                const width = Math.abs(currentX);
                bgRight.style.width = `${width}px`;
                const icon = bgRight.querySelector("svg");
                if (width > 60) {
                    bgRight.style.backgroundColor = "#3b82f6";
                    if (icon) icon.style.transform = "scale(1.2)";
                    if (!hasVibrated) {
                        if (navigator.vibrate) navigator.vibrate(50);
                        hasVibrated = true;
                    }
                } else {
                    bgRight.style.backgroundColor = "rgba(59, 130, 246, 0.4)";
                    if (icon) icon.style.transform = "scale(1)";
                    hasVibrated = false;
                }
            }
        };

        const onEnd = () => {
            node.style.transition =
                "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)";
            node.style.transform = "translate3d(0, 0, 0)";

            bgLeft.style.transition =
                "width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.3s";
            bgLeft.style.width = "0px";
            bgRight.style.transition =
                "width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.3s";
            bgRight.style.width = "0px";

            if (currentX > 60 && !blockSwipe) {
                userQueue.update((q) => [...q, track]);
                showToast(`Added to queue`);
            } else if (currentX < -60 && !blockSwipe) {
                openPlaylistSelector(track);
            }

            setTimeout(() => {
                isSwiping = false;
                currentX = 0;
                blockSwipe = false;
            }, 50);
        };

        node.addEventListener("touchstart", onStart, { passive: true });
        node.addEventListener("touchmove", onMove, { passive: true });
        node.addEventListener("touchend", onEnd);
        return {
            destroy() {
                node.removeEventListener("touchstart", onStart);
                node.removeEventListener("touchmove", onMove);
                node.removeEventListener("touchend", onEnd);
            },
        };
    }

    // ─── FULLSCREEN PS2 REACTIVE TOWER SCENE ─────────────────────────────
    let hoveredTower = null; 

    function initPS2(canvas) {
        // ── Basic Setup ────────────────────────────
        const scene = new THREE.Scene();
        scene.background = new THREE.Color( 0x050505 );
        
        // Multi-layered Real PS2 Fog Simulation
        scene.fog = new THREE.FogExp2(0x050505, 0.015);

        // Standard Top-Down Perspective Camera from your recreation
        const camera = new THREE.PerspectiveCamera( 25, window.innerWidth / window.innerHeight, 1, 1100 );
        const cameraTarget = new THREE.Vector3(0, 0, 0);
        camera.position.set(0, 0, 107);
        camera.lookAt(cameraTarget);

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);

        // Lighting
        const spotLight = new THREE.SpotLight( 0xffffff, 1.2 );
        spotLight.position.set( 0, 0, 100 );
        scene.add( spotLight );
        scene.add(new THREE.AmbientLight(0x404040, 1)); // Soft ambient to see colors

        // ── Reactive Track Pillars ──────────────────
        const trackMeshes = [];
        
        // Layout perfectly centered grid 
        const cols = Math.ceil(Math.sqrt(tracks.length));
        const rows = Math.ceil(tracks.length / cols);
        const spacing = 1.4; 
        
        const offsetX = ((cols - 1) * spacing) / 2;
        const offsetY = ((rows - 1) * spacing) / 2;

        tracks.forEach((track, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);

            // Reactive Height based on Playcount logic
            const zDepth = maxPlay > 0 
                ? 5 + ((track.playCount || 0) / maxPlay) * 15
                : 5 + Math.random() * 5;

            const geometry = new THREE.BoxGeometry(1.1, 1.1, zDepth);
            const ranGrey = new THREE.Color(`hsl(189, 0%, ${40 + Math.floor(Math.random() * 30)}%)`);
            
            const material = new THREE.MeshPhongMaterial({
                color: ranGrey, 
                transparent: true, 
                refractionRatio: 0.7, 
                reflectivity: 0.9,
                emissive: ranGrey,
                emissiveIntensity: 0.15
            });

            const cube = new THREE.Mesh(geometry, material);
            // Arrange flatly and stretch outward in Z like original
            cube.position.set( (col * spacing) - offsetX, (row * spacing) - offsetY, 70 );
            
            cube.userData = { 
                track: track, 
                index: i,
                baseColor: ranGrey.clone()
            };

            scene.add(cube);
            trackMeshes.push(cube);
        });

        // ── Authentic Glass Boxes ───────────────────
        const glassBoxGeo = new THREE.BoxGeometry( 1, 1, 1 );
        const glassBoxMat = new THREE.MeshPhongMaterial( { color: 0x474141, transparent: true, opacity: 0.8 } ); 

        const glassCubes = [
            new THREE.Mesh(glassBoxGeo, glassBoxMat),
            new THREE.Mesh(glassBoxGeo, glassBoxMat),
            new THREE.Mesh(glassBoxGeo, glassBoxMat),
            new THREE.Mesh(glassBoxGeo, glassBoxMat),
            new THREE.Mesh(glassBoxGeo, glassBoxMat)
        ];
        
        glassCubes[0].position.set(-4, 1, 85);
        glassCubes[1].position.set(3.5, 2, 86);
        glassCubes[2].position.set(-0.5, .5, 81);
        glassCubes[2].rotation.set(.3, .4, .1);
        glassCubes[3].position.set(-2.8, -2, 88);
        glassCubes[4].position.set(3, -1.3, 80);
        
        glassCubes.forEach(c => scene.add(c));

        // ── Complex Fog Layers ──────────────────────
        // Generating a soft smoke texture entirely through code
        const texCanvas = document.createElement('canvas');
        texCanvas.width = 128; texCanvas.height = 128;
        const ctx = texCanvas.getContext('2d');
        const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);
        const smokeTex = new THREE.CanvasTexture(texCanvas);

        const smokeGeo = new THREE.PlaneGeometry(35, 35);
        const smokeMat = new THREE.MeshBasicMaterial({
            map: smokeTex,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            color: 0x2244bb // iconic PS2 blue tint
        });

        const fogPlanes = [];
        for(let i=0; i<45; i++) {
            const plane = new THREE.Mesh(smokeGeo, smokeMat);
            plane.position.set(
                (Math.random() - 0.5) * 60,
                (Math.random() - 0.5) * 60,
                80 + Math.random() * 25
            );
            plane.rotation.z = Math.random() * Math.PI * 2;
            scene.add(plane);
            fogPlanes.push({ mesh: plane, speed: (Math.random() * 0.002) + 0.001 });
        }

        // ── Post Processing (Bloom for highlights) ──
        const composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.4, 0.85);
        composer.addPass(bloom);

        // ── Raycaster & Interactions ────────────────
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        let activeHoverMesh = null;

        const updateMouse = (e) => {
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        };

        const onMouseMove = (e) => {
            updateMouse(e);
            raycaster.setFromCamera(mouse, camera);
            
            const intersects = raycaster.intersectObjects(trackMeshes);
            
            if (intersects.length > 0) {
                const hitMesh = intersects[0].object;
                
                if (activeHoverMesh !== hitMesh) {
                    // Reset old hover
                    if (activeHoverMesh) {
                        activeHoverMesh.material.emissive.copy(activeHoverMesh.userData.baseColor);
                        activeHoverMesh.material.emissiveIntensity = 0.15;
                    }
                    // Apply new bold highlight
                    activeHoverMesh = hitMesh;
                    activeHoverMesh.material.emissive.setHex(0x00ffff); // Cyan hover glow
                    activeHoverMesh.material.emissiveIntensity = 0.8;
                    
                    hoveredTower = {
                        title: hitMesh.userData.track.title,
                        playCount: hitMesh.userData.track.playCount || 0,
                        x: e.clientX,
                        y: e.clientY
                    };
                    canvas.style.cursor = 'pointer';
                }
            } else {
                if (activeHoverMesh) {
                    activeHoverMesh.material.emissive.copy(activeHoverMesh.userData.baseColor);
                    activeHoverMesh.material.emissiveIntensity = 0.15;
                    activeHoverMesh = null;
                    hoveredTower = null;
                    canvas.style.cursor = 'default';
                }
            }
        };

        const onClick = (e) => {
            if (activeHoverMesh) {
                playSpecificTrack(tracks.findIndex(t => t.id === activeHoverMesh.userData.track.id));
            }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('click', onClick);

        // Resize handler for absolute fullscreen
        const onResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            composer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', onResize);

        // ── Animation Loop ──────────────────────────
        const clock = new THREE.Clock();
        let t = 0;
        let raf;

        const animate = () => {
            raf = requestAnimationFrame( animate );
            t = clock.getElapsedTime();

            // Glass rotation from Original
            glassCubes[0].rotation.z -= 0.002;
            glassCubes[0].rotation.x += 0.002;
            glassCubes[1].rotation.x -= 0.002;
            glassCubes[1].rotation.z -= 0.002;
            glassCubes[2].rotation.x += 0.002;
            glassCubes[3].rotation.x += 0.002;
            glassCubes[3].rotation.y -= 0.002;
            glassCubes[4].rotation.x += 0.002;
            glassCubes[4].rotation.y -= 0.002;

            // Animate complex fog mist layers
            fogPlanes.forEach(fp => {
                fp.mesh.rotation.z += fp.speed;
            });

            // Camera float: Viewable statically until user closes, 
            // drifting slowly in a figure-8 to give a living breathing feel
            camera.position.x = Math.sin(t * 0.2) * 1.5;
            camera.position.y = Math.cos(t * 0.1) * 1.5;
            camera.lookAt(cameraTarget);

            composer.render();
        };
        animate();

        return {
            destroy() {
                cancelAnimationFrame(raf);
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('click', onClick);
                window.removeEventListener('resize', onResize);
                renderer.dispose();
                // Clear out geometries
                glassBoxGeo.dispose();
                glassBoxMat.dispose();
                smokeGeo.dispose();
                smokeMat.dispose();
                trackMeshes.forEach(m => {
                    m.geometry.dispose();
                    m.material.dispose();
                });
                hoveredTower = null;
            }
        };
    }

    let showPlaylistModal = false;
    let trackToAdd = null;
    let userPlaylists = [];

    let modalTop = 0;
    let modalHeight = 0;

    const openPlaylistSelector = async (track) => {
        trackToAdd = track;
        const mainView = document.getElementById("main-view");

        if (mainView) {
            modalTop = mainView.scrollTop;
            modalHeight = mainView.clientHeight;
            mainView.style.overflow = "hidden";
        }

        showPlaylistModal = true;
        try {
            userPlaylists = await api.getPlaylists();
        } catch (e) {}
    };

    const closePlaylistSelector = () => {
        showPlaylistModal = false;
        trackToAdd = null;
        tracksToAdd = [];
        selectedTracks = new Set();

        const mainView = document.getElementById("main-view");
        if (mainView) {
            mainView.style.overflow = "";
        }
    };

    const addToPlaylist = async (playlistId) => {
        if (tracksToAdd.length > 0) {
            const count = await api.addTracksToPlaylist(playlistId, tracksToAdd.map(t => t.id));
            if (count > 0) {
                showToast(`Added ${count} track${count > 1 ? 's' : ''} to playlist`);
            }
            closePlaylistSelector();
            return;
        }
        if (!trackToAdd) return;
        const success = await api.addToPlaylist(playlistId, trackToAdd.id);
        if (success) {
            showToast('Added to playlist');
            closePlaylistSelector();
        }
    };

    const goArtist = () => {
        if (album && album.artistId) {
            window.location.hash = `#artist/${album.artistId}`;
        }
    };

    // ─── DRAG-AND-DROP (Desktop Only) ─────────────────────────────────────

    let selectedTracks = new Set();
    let isDragging = false;
    let dragCount = 0;
    let tracksToAdd = [];

    const handleTrackSelect = (e, track, globalIndex) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            selectedTracks = new Set(selectedTracks);
            if (selectedTracks.has(track.id)) {
                selectedTracks.delete(track.id);
            } else {
                selectedTracks.add(track.id);
            }
        } else if (!selectedTracks.has(track.id)) {
            selectedTracks = new Set();
            playSpecificTrack(globalIndex);
        } else {
            playSpecificTrack(globalIndex);
        }
    };

    const handleDragStart = (e, track) => {
        if (e.touches) return;

        isDragging = true;
        let draggedTracks;

        if (selectedTracks.size > 0 && selectedTracks.has(track.id)) {
            draggedTracks = tracks.filter(t => selectedTracks.has(t.id));
        } else {
            draggedTracks = [track];
        }

        dragCount = draggedTracks.length;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', JSON.stringify(draggedTracks.map(t => t.id)));

        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost-el';
        ghost.textContent = dragCount > 1 ? `${dragCount} tracks` : track.title;
        ghost.style.cssText = 'position:fixed;left:-9999px;top:-9999px;padding:8px 16px;background:rgba(0,0,0,0.85);color:white;border-radius:10px;font-size:13px;font-weight:600;backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.15);white-space:nowrap;z-index:999999;pointer-events:none;';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        setTimeout(() => ghost.remove(), 0);
    };

    const handleDragEnd = () => {
        isDragging = false;
        dragCount = 0;
    };

    const handleDropOnTarget = (e) => {
        e.preventDefault();
        isDragging = false;

        try {
            const trackIds = JSON.parse(e.dataTransfer.getData('text/plain'));
            const droppedTracks = tracks.filter(t => trackIds.includes(t.id));
            if (droppedTracks.length > 0) {
                tracksToAdd = droppedTracks;
                openPlaylistSelector(droppedTracks[0]);
            }
        } catch {}

        dragCount = 0;
    };

    const handleDropTargetDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    };
</script>

<svelte:window on:click={handleGlobalClick} />

{#if album}
    <div class="view-wrapper" class:max-glass={$isMaxGlassActive}>
        {#if !$isGlobalColorActive}
            <div
                class="fade-bg-dynamic"
                style="background-color: {albumColor};"
            ></div>
        {/if}

        <div class="album-header-block">
            <div class="album-hero">
                <div class="cover-wrapper">
                    <img
                        src={coverUrl}
                        alt="Cover"
                        loading="lazy"
                        on:error={handleImageError}
                    />
                </div>
                <div class="album-info">
                    <div class="album-type">Album</div>
                    <div class="album-title">{album.title}</div>
                    <div class="album-meta">
                        <strong
                            class="album-artist-name hoverable"
                            role="button"
                            tabindex="0"
                            on:click={goArtist}
                            on:keydown={(e) => e.key === "Enter" && goArtist()}
                        >
                            {album.artistName}
                        </strong>
                        
                        <span class="dot desktop-dot">•</span>
                        
                        <div class="meta-secondary">
                            {#if album.releaseYear > 0}
                                <span class="album-info-text">{album.releaseYear}</span>
                                <span class="dot">•</span>
                            {/if}
                            <span class="album-info-text">{tracks.length} songs</span>
                            <span class="dot">•</span>
                            <span class="duration-highlight">{timeString}</span>

                            {#if avgBitrate > 0}
                                <div class="kbps-badge-inline">
                                    <svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="var(--accent-color)"
                                        ><rect
                                            x="3"
                                            y="8"
                                            width="4"
                                            height="8"
                                        /><rect
                                            x="10"
                                            y="4"
                                            width="4"
                                            height="16"
                                        /><rect
                                            x="17"
                                            y="10"
                                            width="4"
                                            height="4"
                                        /></svg
                                    >
                                    <span>{avgBitrate} kbps</span>
                                </div>
                            {/if}
                        </div>
                    </div>
                </div>
            </div>

            <div class="header-separator"></div>

            <div class="action-bar">
                <button
                    class="btn-main-play hoverable"
                    aria-label="Play Album"
                    on:click={togglePlayAlbum}
                >
                    {#if isPlayingAlbum}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="28"
                            height="28"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            stroke="currentColor"
                            stroke-width="2"
                            ><rect width="4" height="16" x="6" y="4"
                            ></rect><rect width="4" height="16" x="14" y="4"
                            ></rect></svg
                        >
                    {:else}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="28"
                            height="28"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            stroke="currentColor"
                            stroke-width="2"
                            ><polygon points="5 3 19 12 5 21 5 3"
                            ></polygon></svg
                        >
                    {/if}
                </button>
                <button
                    class="btn-icon-bar hoverable"
                    aria-label="Shuffle"
                    class:active={$isShuffle}
                    on:click={toggleShuffleMode}
                    title="Shuffle"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="32"
                        height="32"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        ><path
                            d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"
                        ></path><path d="m18 2 4 4-4 4"></path><path
                            d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"
                        ></path><path
                            d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"
                        ></path><path d="m18 14 4 4-4 4"></path></svg
                    >
                </button>
                <button
                    class="btn-icon-bar hoverable"
                    aria-label="Stats View"
                    class:active={viewMode === "stats"}
                    on:click={() =>
                        (viewMode = viewMode === "stats" ? "list" : "stats")}
                    title="Toggle Stats Bar"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="28"
                        height="28"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        ><line x1="18" y1="20" x2="18" y2="10"></line><line
                            x1="12"
                            y1="20"
                            x2="12"
                            y2="4"
                        ></line><line x1="6" y1="20" x2="6" y2="14"></line></svg
                    >
                </button>
                <button
                    class="btn-icon-bar hoverable"
                    aria-label="PS2 View"
                    class:active={viewMode === "ps2"}
                    on:click={() =>
                        (viewMode = viewMode === "ps2" ? "list" : "ps2")}
                    title="PS2 Tower View"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="28"
                        height="28"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        ><rect x="2" y="7" width="20" height="14" rx="2" ry="2"
                        ></rect><path
                            d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"
                        ></path></svg
                    >
                </button>
                <button
                    class="btn-download btn-icon-bar hoverable"
                    on:click={downloadAlbum}
                    disabled={isDownloading}
                    title="Make available offline"
                >
                    <svg
                        viewBox="0 0 24 24"
                        width="28"
                        height="28"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 8v8"></path>
                        <path d="M8 12l4 4 4-4"></path>
                    </svg>
                </button>
            </div>
        </div>

        {#if viewMode === "ps2"}
            <div
                use:portal
                class="ps2-fullscreen-overlay"
                in:fade={{ duration: 300 }}
                out:fade={{ duration: 250 }}
            >
                <button 
                    class="btn-close-ps2" 
                    on:click={() => viewMode = 'list'}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    Exit PS2 View
                </button>

                <canvas class="ps2-canvas" use:initPS2></canvas>

                {#if hoveredTower}
                    <div
                        class="ps2-hud"
                        style="left: {hoveredTower.x}px; top: {hoveredTower.y - 70}px;"
                    >
                        <span class="ps2-hud-title">{hoveredTower.title}</span>
                        <span class="ps2-hud-plays">{hoveredTower.playCount} plays</span>
                    </div>
                {/if}
            </div>
        {:else}
            <div
                class="list-container active-view"
                class:show-stats={viewMode === "stats"}
                id="tracks-container"
                in:fade={{ duration: 200 }}
            >
                <div class="list-header">
                    <div style="text-align:center;">#</div>
                    <div>Title</div>
                    <div style="text-align:right; margin-right: 6px;">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><circle cx="12" cy="12" r="10"></circle><polyline
                                points="12 6 12 12 16 14"
                            ></polyline></svg
                        >
                    </div>
                </div>

                {#each discs as disc}
                    {#if discs.length > 1}
                        <div class="disc-header">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                ><circle cx="12" cy="12" r="10"></circle><circle
                                    cx="12"
                                    cy="12"
                                    r="2"
                                ></circle></svg
                            >
                            DISC {disc}
                        </div>
                    {/if}

                    {#each tracks.filter((t) => (t.discNumber || 1) === disc) as track}
                        {@const globalIndex = tracks.findIndex(
                            (t) => t.id === track.id,
                        )}
                        {@const pct =
                            totalAlbumPlays > 0
                                ? ((track.playCount || 0) / totalAlbumPlays) *
                                  100
                                : 0}

                        <div
                            class="list-item"
                            class:active={$currentPlaylist.length > 0 &&
                                $currentPlaylist[$currentIndex]?.id ===
                                    track.id}
                        >
                            <div class="swipe-bg-left">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="24"
                                    height="24"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="#000"
                                    stroke-width="2.5"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                >
                                    <rect
                                        x="6"
                                        y="5"
                                        width="12"
                                        height="6"
                                        rx="3"
                                    />
                                    <line x1="6" y1="15" x2="18" y2="15"></line>
                                    <line x1="6" y1="19" x2="18" y2="19"></line>
                                </svg>
                            </div>

                            <div class="swipe-bg-right">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="#000"
                                    stroke-width="3"
                                >
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                    <circle cx="12" cy="12" r="10" />
                                </svg>
                            </div>
                            <div
                                class="stat-bar"
                                style="--stat-w: {mounted &&
                                viewMode === 'stats'
                                    ? pct
                                    : 0}%; transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) {globalIndex *
                                    0.04}s;"
                            ></div>
                            <div
                                class="list-item-content"
                                class:track-selected={selectedTracks.has(track.id)}
                                role="button"
                                tabindex="0"
                                draggable="true"
                                use:swipeToQueue={track}
                                on:click={(e) => handleTrackSelect(e, track, globalIndex)}
                                on:keydown={(e) =>
                                    e.key === "Enter" &&
                                    playSpecificTrack(globalIndex)}
                                on:contextmenu={(e) =>
                                    openContextMenu(e, track)}
                                on:dragstart={(e) => handleDragStart(e, track)}
                                on:dragend={handleDragEnd}
                            >
                                <div class="list-item-num">
                                    {track.trackNumber > 0
                                        ? track.trackNumber
                                        : globalIndex + 1}
                                </div>
                                <div style="min-width: 0;">
                                    <div class="list-item-title">
                                        {track.title}
                                    </div>
                                    <div class="list-item-artist">
                                        {album.artistName}
                                    </div>
                                </div>

                                <div
                                    class="list-item-time"
                                    style="display: flex; align-items: center; gap: 6px; "
                                >
                                    <button
                                        class="btn-add-playlist"
                                        aria-label="Add to Playlist"
                                        on:click|stopPropagation={() =>
                                            openPlaylistSelector(track)}
                                    >
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="20"
                                            height="20"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            ><circle cx="12" cy="12" r="10"
                                            ></circle><line
                                                x1="12"
                                                y1="8"
                                                x2="12"
                                                y2="16"
                                            ></line><line
                                                x1="8"
                                                y1="12"
                                                x2="16"
                                                y2="12"
                                            ></line></svg
                                        >
                                    </button>
                                    <div style="font-size: 12px;">
                                        {formatTime(track.durationSeconds)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    {/each}
                {/each}
            </div>
        {/if}
    </div>
{/if}

{#if isDragging}
    <div 
        class="drop-target-pill"
        on:drop={handleDropOnTarget}
        on:dragover={handleDropTargetDragOver}
        in:scale={{ start: 0.8, duration: 200, opacity: 0 }}
        out:fade={{ duration: 150 }}
    >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>Drop to add to playlist{dragCount > 1 ? ` (${dragCount})` : ''}</span>
    </div>
{/if}

{#if showPlaylistModal}
    <div
        class="modal-backdrop"
        role="button"
        tabindex="-1"
        style="top: {modalTop}px; height: {modalHeight}px;"
        in:fade={{ duration: 200 }}
        out:fade={{ duration: 150 }}
        on:click={closePlaylistSelector}
        on:keydown={(e) => e.key === "Escape" && closePlaylistSelector()}
    >
        <div
            class="modal-glass-card"
            role="dialog"
            aria-modal="true"
            in:scale={{ start: 0.95, duration: 250, opacity: 0 }}
            on:click|stopPropagation
        >
            <div class="modal-header">
                <h3>Add to Playlist</h3>
                <button class="btn-close" on:click={closePlaylistSelector}>
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        ><line x1="18" y1="6" x2="6" y2="18"></line><line
                            x1="6"
                            y1="6"
                            x2="18"
                            y2="18"
                        ></line></svg
                    >
                </button>
            </div>

            <div class="track-preview">
                <div class="preview-title">{trackToAdd?.title}</div>
                <div class="preview-artist">{album?.artistName}</div>
            </div>

            <div class="modal-list">
                {#each userPlaylists as playlist}
                    <button
                        class="modal-list-item"
                        on:click={() => addToPlaylist(playlist.id)}
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
                            ></path><polyline points="17 8 12 3 7 8"
                            ></polyline><line x1="12" y1="3" x2="12" y2="15"
                            ></line></svg
                        >
                        {playlist.name}
                    </button>
                {/each}
                {#if userPlaylists.length === 0}
                    <div
                        style="text-align: center; color: rgba(255,255,255,0.4); padding: 16px;"
                    >
                        No playlists found. Create one first!
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<div
    use:portal
    class="app-overlays"
    style="position: absolute; z-index: 9999999;"
>
    {#if toastMessage}
        <div
            class="toast-notification"
            in:scale={{ start: 0.8, duration: 250 }}
            out:fade={{ duration: 200 }}
        >
            <svg
                class="toast-icon"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Added to Queue</span>
        </div>
    {/if}

    {#if contextMenu.show}
        <div
            class="context-menu-glass"
            role="menu"
            style="top: {contextMenu.y}px; left: {contextMenu.x}px;"
            in:scale={{ start: 0.95, duration: 150 }}
            out:fade={{ duration: 100 }}
            on:click|stopPropagation
        >
            <div class="context-header">
                <span class="context-title">{contextMenu.track.title}</span>
            </div>
            <button
                class="context-btn"
                on:click={() => {
                    playSpecificTrack(
                        tracks.findIndex((t) => t.id === contextMenu.track.id),
                    );
                    closeContextMenu();
                }}
            >
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    stroke="currentColor"
                    stroke-width="2"
                    ><polygon points="5 3 19 12 5 21 5 3"></polygon></svg
                >
                Play Now
            </button>
            <button
                class="context-btn"
                on:click={() => addToQueueContext(contextMenu.track)}
            >
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><line x1="12" y1="5" x2="12" y2="19"></line><line
                        x1="5"
                        y1="12"
                        x2="19"
                        y2="12"
                    ></line></svg
                >
                Add to Queue
            </button>
            <button
                class="context-btn"
                on:click={() => {
                    openPlaylistSelector(contextMenu.track);
                    closeContextMenu();
                }}
            >
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
                    ></path><polyline points="17 8 12 3 7 8"></polyline><line
                        x1="12"
                        y1="3"
                        x2="12"
                        y2="15"
                    ></line></svg
                >
                Add to Playlist
            </button>
        </div>
    {/if}
</div>

<style>
    /* ─── NEW FULLSCREEN PS2 STYLES ──────────────────────────── */
    .ps2-fullscreen-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: #000;
        z-index: 9999999;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .btn-close-ps2 {
        position: absolute;
        top: 24px;
        right: 24px;
        z-index: 10000000;
        background: rgba(255, 255, 255, 0.1);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.2);
        padding: 10px 20px;
        border-radius: 30px;
        cursor: pointer;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        font-weight: 600;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: all 0.2s ease;
    }
    
    .btn-close-ps2:hover {
        background: rgba(255, 255, 255, 0.2);
        transform: scale(1.05);
    }

    .ps2-canvas {
        display: block;
        width: 100%;
        height: 100%;
        cursor: default;
    }

    .ps2-hud {
        position: absolute;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.9);
        border: 1px solid rgba(0, 255, 255, 0.6);
        border-radius: 8px;
        padding: 6px 14px;
        pointer-events: none;
        white-space: nowrap;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        box-shadow: 0 0 20px rgba(0, 255, 255, 0.3);
        z-index: 10000000;
    }
    .ps2-hud-title {
        color: #fff;
        font-size: 14px;
        font-weight: 800;
    }
    .ps2-hud-plays {
        color: rgba(0, 255, 255, 0.9);
        font-size: 11px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 1px;
    }

    /* ─── EXISTING STYLES ────────────────────────────────────── */
    .album-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
    }
    .album-artist-name {
        color: rgba(255, 255, 255, 0.95);
        cursor: pointer;
    }
    .meta-secondary {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
    }
    .desktop-dot {
        display: inline;
    }
    .cover-wrapper {
        width: 232px; 
        height: 232px;
        flex-shrink: 0; 
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
        background: #222; 
    }

    .cover-wrapper img {
        width: 100%;
        height: 100%;
        object-fit: cover; 
        display: block;
    }
    .view-wrapper {
        position: relative;
        min-height: 100%;
    }
    .fade-bg-dynamic {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 400px;
        -webkit-mask-image: linear-gradient(
            to bottom,
            rgba(0, 0, 0, 1) 0%,
            rgba(0, 0, 0, 0) 100%
        );
        mask-image: linear-gradient(
            to bottom,
            rgba(0, 0, 0, 1) 0%,
            rgba(0, 0, 0, 0) 100%
        );
        opacity: 0.35;
        z-index: 0;
        pointer-events: none;
        transition: background-color 0.8s ease-in-out;
        border-top-left-radius: 24px;
        border-top-right-radius: 24px;
    }
    .album-header-block {
        display: flex;
        flex-direction: column;
        gap: 0;
        margin-bottom: 24px;
        background: rgba(255, 255, 255, 0.03);
        backdrop-filter: blur(32px) saturate(150%);
        -webkit-backdrop-filter: blur(32px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 24px;
        padding: 20px;
        box-shadow:
            0 8px 32px rgba(0, 0, 0, 0.2),
            inset 1px 1px 0 rgba(255, 255, 255, 0.05);
        will-change: transform, backdrop-filter;
    }
    .album-hero {
        display: flex;
        gap: 24px;
        align-items: flex-end;
        margin-bottom: 0;
    }
    .action-bar {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 0;
    }
    .header-separator {
        height: 1px;
        background: rgba(255, 255, 255, 0.1);
        margin: 16px 0;
        width: 100%;
    }
    .max-glass .album-header-block {
        background: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.1);
        box-shadow:
            0 8px 32px rgba(0, 0, 0, 0.2),
            inset 1px 1px 0 rgba(255, 255, 255, 0.1);
    }
    .max-glass .list-container {
        background: rgba(255, 255, 255, 0.03);
        backdrop-filter: blur(32px) saturate(150%);
        -webkit-backdrop-filter: blur(32px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 24px;
        padding: 16px;
        box-shadow: inset 1px 1px 0 rgba(255, 255, 255, 0.05);
        will-change: transform, backdrop-filter;
    }
    .max-glass .list-item {
        border-radius: 12px;
        background: transparent;
        border-bottom: 1px solid rgba(255, 255, 255, 0.02);
    }
    @media (hover: hover) {
        .max-glass .list-item:hover {
            background: rgba(255, 255, 255, 0.08);
        }
    }
    .duration-highlight {
        color: rgba(255, 255, 255, 0.95);
        font-weight: 800;
    }
    .kbps-badge-inline {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(0, 0, 0, 0.4);
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 11px;
        font-family: monospace;
        font-weight: bold;
        border: 1px solid rgba(255, 255, 255, 0.1);
        margin-left: 12px;
        vertical-align: middle;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }
    .hoverable {
        transition:
            transform 0.2s,
            background 0.2s,
            color 0.2s;
        cursor: pointer;
    }
    @media (hover: hover) {
        .btn-main-play.hoverable:hover {
            transform: scale(1.05);
            background: var(--accent-color);
            color: black;
        }
        .btn-icon-bar.hoverable:hover {
            color: white;
            transform: scale(1.1);
        }
    }
    .disc-header {
        font-size: 12px;
        font-weight: 800;
        color: var(--accent-color);
        letter-spacing: 1px;
        padding: 24px 8px 8px 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
        text-transform: uppercase;
    }

    .btn-add-playlist {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.3);
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        border-radius: 50%;
    }
    @media (hover: hover) {
        .btn-add-playlist:hover {
            color: var(--accent-color);
            background: rgba(255, 255, 255, 0.05);
            transform: scale(1.1);
        }
    }

    @media (max-width: 768px) {
        .album-header-block {
            padding: 16px 12px 12px 12px !important;
            margin-bottom: 16px !important;
        }

        .album-hero {
            flex-direction: column;
            align-items: center;
            gap: 20px;
            text-align: center;
        }

        .cover-wrapper {
            width: 200px !important; 
            height: 200px !important;
            margin: 0 auto; 
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.5); 
        }

        .cover-wrapper img {
            width: 100% !important;
            height: 100% !important;
        }

        .album-info {
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
        }

        .header-separator {
            margin: 12px 0 !important;
        }

        .album-info-text,
        .duration-highlight {
            font-size: 12px;
        }

        .album-title {
            font-size: 24px;
            margin-bottom: 4px;
        }

        .action-bar {
            justify-content: center; 
            gap: 20px !important;
            margin-top: 8px;
        }

        .list-item-title {
            padding-right: 12px;
            font-size: 14px;
        }
        .album-meta {
            flex-direction: column; 
            justify-content: center;
            gap: 6px;
        }
        
        .desktop-dot {
            display: none; 
        }
        
        .meta-secondary {
            justify-content: center;
            row-gap: 8px; 
        }

        .kbps-badge-inline {
            margin-left: 2px !important; 
        }
    }

    .modal-backdrop {
        position: absolute;
        left: 0;
        width: 100%;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .modal-glass-card {
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(40px) saturate(150%);
        -webkit-backdrop-filter: blur(40px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-top: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 24px;
        padding: 24px;
        width: 90%;
        max-width: 400px;
        box-shadow: 0 32px 64px rgba(0, 0, 0, 0.5);
    }

    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
    }

    .modal-header h3 {
        margin: 0;
        color: white;
        font-weight: 800;
        font-size: 20px;
    }

    .btn-close {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        padding: 4px;
        border-radius: 50%;
        transition: all 0.2s;
    }
    .btn-close:hover {
        color: white;
        background: rgba(255, 255, 255, 0.1);
    }

    .track-preview {
        background: rgba(0, 0, 0, 0.3);
        padding: 12px 16px;
        border-radius: 12px;
        margin-bottom: 24px;
        border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .preview-title {
        color: white;
        font-weight: bold;
        font-size: 15px;
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .preview-artist {
        color: rgba(255, 255, 255, 0.5);
        font-size: 13px;
    }

    .modal-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 300px;
        overflow-y: auto;
    }

    .modal-list-item {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid transparent;
        color: white;
        font-weight: 600;
        padding: 16px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        transition: all 0.2s;
        text-align: left;
    }

    .modal-list-item svg {
        color: rgba(255, 255, 255, 0.5);
        transition: color 0.2s;
    }
    @media (hover: hover) {
        .modal-list-item:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.1);
        }
        .modal-list-item:hover svg {
            color: var(--accent-color);
        }
    }

    .swipe-bg-left,
    .swipe-bg-right {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        border-radius: 8px;
        overflow: hidden;
    }

    .swipe-bg-left {
        left: 0;
        background: rgba(16, 185, 129, 0.4);
    }
    .swipe-bg-right {
        right: 0;
        background: rgba(59, 130, 246, 0.4);
        justify-content: flex-end;
    }

    .swipe-bg-left svg {
        margin-left: 20px;
        flex-shrink: 0;
        transition: transform 0.2s;
    }
    .swipe-bg-right svg {
        margin-right: 20px;
        flex-shrink: 0;
        transition: transform 0.2s;
    }

    .toast-notification {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(20, 20, 20, 0.85);
        backdrop-filter: blur(25px) saturate(150%);
        -webkit-backdrop-filter: blur(25px) saturate(150%);
        color: white;
        font-weight: 600;
        font-size: 16px;
        width: 170px;
        height: 170px;
        border-radius: 28px;
        z-index: 9999999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        box-shadow:
            0 20px 50px rgba(0, 0, 0, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.05);
        pointer-events: none; 
    }
    .toast-icon {
        width: 56px;
        height: 56px;
        stroke-width: 1.5px;
        stroke: white;
    }

    .context-menu-glass {
        position: fixed;
        width: 220px;
        z-index: 9999999;
        background: rgba(25, 25, 25, 0.85);
        backdrop-filter: blur(32px) saturate(150%);
        -webkit-backdrop-filter: blur(32px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 14px;
        box-shadow:
            0 16px 40px rgba(0, 0, 0, 0.6),
            inset 0 1px 0 rgba(255, 255, 255, 0.05);
        display: flex;
        flex-direction: column;
        padding: 6px;
    }
    .context-header {
        padding: 8px 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        margin-bottom: 4px;
    }
    .context-title {
        font-size: 12px;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.5);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: block;
    }
    .context-btn {
        background: transparent;
        border: none;
        color: white;
        font-size: 14px;
        font-weight: 500;
        padding: 10px 12px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        transition: background 0.2s;
        text-align: left;
    }
    @media (hover: hover) {
        .context-btn:hover {
            background: rgba(255, 255, 255, 0.1);
            color: var(--accent-color);
        }
        .context-btn:hover svg {
            color: var(--accent-color);
        }
    }

    .btn-download {
        background: transparent;
        color: var(--text-secondary, #aaa);
        border: none;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .btn-download:disabled {
        opacity: 0.5;
        cursor: wait;
        animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(0.95); }
        100% { transform: scale(1); }
    }

    .track-selected {
        background: rgba(var(--accent-rgb, 181, 52, 209), 0.15) !important;
        border-left: 2px solid var(--accent-color, #b534d1);
    }

    .drop-target-pill {
        position: fixed;
        bottom: 120px;
        right: 24px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 24px;
        background: rgba(20, 20, 20, 0.85);
        backdrop-filter: blur(30px) saturate(150%);
        -webkit-backdrop-filter: blur(30px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 16px;
        color: white;
        font-size: 14px;
        font-weight: 700;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.05);
        z-index: 99999;
        cursor: copy;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .drop-target-pill:hover {
        transform: scale(1.05);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), 0 0 20px rgba(var(--accent-rgb, 181, 52, 209), 0.3);
        border-color: var(--accent-color, #b534d1);
    }

    .drop-target-pill svg {
        color: var(--accent-color, #b534d1);
    }

    .list-item-content[draggable="true"] {
        cursor: grab;
    }
    .list-item-content[draggable="true"]:active {
        cursor: grabbing;
    }

    @media (hover: none) and (pointer: coarse) {
        .list-item-content[draggable="true"] {
            cursor: default;
        }
        .drop-target-pill {
            display: none;
        }
    }
</style>