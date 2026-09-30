/*
 * Decompiled with CFR 0.152.
 */
package com.codedisaster.steamworks;

public enum SteamRemoteStorage$RemoteStoragePlatform {
    None(0),
    Windows(1),
    OSX(2),
    PS3(4),
    Linux(8),
    Reserved2(16),
    All(-1);

    private final int mask;
    private static final SteamRemoteStorage$RemoteStoragePlatform[] values;

    /*
     * WARNING - Possible parameter corruption
     * WARNING - void declaration
     */
    private SteamRemoteStorage$RemoteStoragePlatform() {
        void var3_1;
        this.mask = var3_1;
    }

    static SteamRemoteStorage$RemoteStoragePlatform[] byMask(int n2) {
        int n3 = Integer.bitCount(n2);
        SteamRemoteStorage$RemoteStoragePlatform[] steamRemoteStorage$RemoteStoragePlatformArray = new SteamRemoteStorage$RemoteStoragePlatform[n3];
        int n4 = 0;
        for (SteamRemoteStorage$RemoteStoragePlatform steamRemoteStorage$RemoteStoragePlatform : values) {
            if ((steamRemoteStorage$RemoteStoragePlatform.mask & n2) == 0) continue;
            steamRemoteStorage$RemoteStoragePlatformArray[n4++] = steamRemoteStorage$RemoteStoragePlatform;
        }
        return steamRemoteStorage$RemoteStoragePlatformArray;
    }

    static /* synthetic */ int access$000(SteamRemoteStorage$RemoteStoragePlatform steamRemoteStorage$RemoteStoragePlatform) {
        return steamRemoteStorage$RemoteStoragePlatform.mask;
    }

    static {
        values = SteamRemoteStorage$RemoteStoragePlatform.values();
    }
}

