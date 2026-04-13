import * as signalR from '@microsoft/signalr';
import { writable, get } from 'svelte/store';

export const myDeviceId = writable(null);
export const targetDeviceId = writable(null);

const _resolveDeviceName = () => {
    if (navigator.userAgentData) {
        const { platform, brands } = navigator.userAgentData;
        const brand = brands.find(
            b => !b.brand.includes('Not') && b.brand !== 'Chromium'
        )?.brand ?? brands.at(-1)?.brand ?? 'Browser';
        return `${brand} on ${platform}`;
    }

    const ua = navigator.userAgent;

    let os = 'Unknown';
    if      (ua.includes('iPhone'))   os = 'iPhone';
    else if (ua.includes('iPad'))     os = 'iPad';
    else if (ua.includes('Android'))  os = 'Android';
    else if (ua.includes('CrOS'))     os = 'ChromeOS';
    else if (ua.includes('Mac'))      os = 'macOS';
    else if (ua.includes('Windows'))  os = 'Windows';
    else if (ua.includes('Linux'))    os = 'Linux';

    let browser = 'Browser';
    if      (ua.includes('Firefox'))                    browser = 'Firefox';
    else if (ua.includes('Edg'))                        browser = 'Edge';
    else if (ua.includes('OPR') || ua.includes('Opera'))browser = 'Opera';
    else if (ua.includes('Chrome'))                     browser = 'Chrome';
    else if (ua.includes('Safari'))                     browser = 'Safari';

    return `${browser} on ${os}`;
};

export const thisDeviceName = _resolveDeviceName();

const _devicesWritable = writable([]);
export const connectedDevices = { subscribe: _devicesWritable.subscribe };

const _addDevice    = (id, name) => _devicesWritable.update(list => {
    if (list.some(d => d.deviceId === id)) return list;
    return [...list, { deviceId: id, deviceName: name }];
});
const _removeDevice = (id) =>
    _devicesWritable.update(list => list.filter(d => d.deviceId !== id));

let connection = null;
let _getState   = null;
let _applyState = null;

export const initSync = async (getStateFn, applyStateFn) => {
    if (connection) return;

    _getState   = getStateFn;
    _applyState = applyStateFn;

    connection = new signalR.HubConnectionBuilder()
        .withUrl('/hubs/playback', { withCredentials: true })
        .withAutomaticReconnect([0, 1000, 3000, 5000, 10000])
        .configureLogging(signalR.LogLevel.Warning)
        .build();

    // CLEANUP: Deduplicated SignalR Listeners
    connection.on('PlaybackStateChanged', (state) => {
        console.log('[Sync] State from', state.deviceName ?? state.deviceId?.slice(0, 8),
                    '| trackId:', state.trackId, '| playing:', state.isPlaying,
                    '| t:', state.currentTime?.toFixed(1));
        
        if (state.targetDeviceId !== undefined) {
            targetDeviceId.set(state.targetDeviceId);
        }
        _applyState?.(state);
    });

    connection.on('StateRequested', async (requestingConnectionId) => {
        try { await connection.invoke('RegisterDevice', thisDeviceName); } catch {}
        const state = _getState?.();
        if (!state) return;
        state.deviceName = thisDeviceName;
        state.targetDeviceId = get(targetDeviceId); 
        try {
            await connection.invoke('SendStateTo', requestingConnectionId, state);
        } catch (e) {
            console.warn('[Sync] SendStateTo failed:', e);
        }
    });

    connection.on('DeviceConnected', (deviceId, deviceName) => {
        console.log('[Sync] Device joined:', deviceName, deviceId?.slice(0, 8));
        _addDevice(deviceId, deviceName);
    });

    connection.on('DeviceDisconnected', (deviceId) => {
        console.log('[Sync] Device left:', deviceId?.slice(0, 8));
        _removeDevice(deviceId);
    });

    connection.onreconnected(async () => {
        console.log('[Sync] Reconnected — re-announcing');
        _devicesWritable.set([]);
        try { await connection.invoke('RegisterDevice', thisDeviceName); } catch {}
    });

    connection.onclose(() => {
        _devicesWritable.set([]);
    });

    try {
        await connection.start();
        myDeviceId.set(connection.connectionId);
        console.log('[Sync] Connected as:', thisDeviceName,
                    '| id:', connection.connectionId?.slice(0, 8));
        await connection.invoke('RegisterDevice', thisDeviceName);
    } catch (e) {
        console.warn('[Sync] Could not connect:', e);
        connection = null;
    }
};

export const broadcastState = async (state) => {
    if (!isConnected()) return;
    state.deviceName = thisDeviceName;
    state.targetDeviceId = get(targetDeviceId);
    try {
        await connection.invoke('BroadcastState', state);
    } catch (e) {}
};

export const stopSync = async () => {
    if (connection) {
        await connection.stop();
        connection  = null;
        _getState   = null;
        _applyState = null;
        _devicesWritable.set([]);
    }
};

export const isConnected = () =>
    connection?.state === signalR.HubConnectionState.Connected;

export const selectTargetDevice = async (id) => {
    targetDeviceId.set(id);
    if (!isConnected() || !_getState) return;
    
    const state = _getState();
    if (state) {
        state.targetDeviceId = id;
        state.timestamp = Date.now();
        await broadcastState(state);
    }
};