/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.librocket.scripts;

import com.Element;
import com.ElementDocument;
import com.corrodinggames.librocket.scripts.Multiplayer$1;
import com.corrodinggames.librocket.scripts.Multiplayer$DropdownOption;
import com.corrodinggames.librocket.scripts.Root;
import com.corrodinggames.librocket.scripts.Root$TableCell;
import com.corrodinggames.librocket.scripts.Root$TableData;
import com.corrodinggames.librocket.scripts.Root$TableRow;
import com.corrodinggames.librocket.scripts.ScriptContext;
import com.corrodinggames.librocket.scripts.ScriptEngine$Action;
import com.corrodinggames.rts.appFramework.i;
import com.corrodinggames.rts.appFramework.j;
import com.corrodinggames.rts.game.n;
import com.corrodinggames.rts.gameFramework.e.a;
import com.corrodinggames.rts.gameFramework.f;
import com.corrodinggames.rts.gameFramework.j.ah;
import com.corrodinggames.rts.gameFramework.j.ai;
import com.corrodinggames.rts.gameFramework.j.am;
import com.corrodinggames.rts.gameFramework.l;
import com.corrodinggames.rts.gameFramework.utility.al;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;

public class Multiplayer
extends ScriptContext {
    Root root;
    String[] currentDropdownRawArray;
    Root$TableData lastPlayerTable;
    boolean useMapDropdown = false;

    Multiplayer(Root root) {
        this.root = root;
    }

    /*
     * WARNING - void declaration
     */
    void updateMapDropdown(Element element, String string2, String string3) {
        void var8_13;
        Object object;
        l l2 = l.B();
        Element element2 = element.getElementById(string3);
        int n2 = element2.getValueAsInt(0);
        this.currentDropdownRawArray = null;
        ArrayList<String[]> arrayList = new ArrayList<String[]>();
        if (n2 == 0) {
            this.currentDropdownRawArray = a.a("maps/skirmish", true);
            Arrays.sort(this.currentDropdownRawArray);
            for (String string4 : this.currentDropdownRawArray) {
                object = i.e(string4);
                arrayList.add((String[])object);
            }
        } else if (n2 == 1) {
            this.currentDropdownRawArray = a.a("/SD/rusted_warfare_maps", true);
            if (this.currentDropdownRawArray == null) {
                l2.a("Could not find folder: /SD/rusted_warfare_maps", 1);
                this.currentDropdownRawArray = new String[0];
            }
            Arrays.sort(this.currentDropdownRawArray);
            for (String string4 : this.currentDropdownRawArray) {
                object = i.e(string4);
                arrayList.add((String[])object);
            }
        } else if (n2 == 2) {
            this.currentDropdownRawArray = j.l();
            if (this.currentDropdownRawArray == null) {
                l2.a("Could not find a save folder on SD card", 1);
                this.currentDropdownRawArray = new String[0];
            }
            for (String string4 : this.currentDropdownRawArray) {
                object = i.e(string4);
                arrayList.add((String[])object);
            }
        } else {
            throw new RuntimeException("Unknown typeIndex:" + n2);
        }
        String string5 = "";
        String string6 = "maps/skirmish";
        int n3 = 0;
        int n4 = 1;
        for (String string7 : this.currentDropdownRawArray) {
            ++n3;
            if (n2 != 0 || !string7.equalsIgnoreCase("[p8]Many Islands (8p).tmx")) continue;
            n4 = n3;
        }
        n3 = 0;
        for (String string7 : this.currentDropdownRawArray) {
            String string8 = this.root.convertMapName(string7);
            boolean bl2 = ++n3 == n4;
            String string9 = (String)var8_13 + this.generateOption(string7, string8, bl2) + "\n";
        }
        l.e("mapList:" + (String)var8_13);
        if (n2 != 2) {
            // empty if block
        }
        object = element.getElementById("mapsSelectorParent");
        String string10 = "<p data-workaround='this stops disappearing select'></p><select id='mapsSelector' class='mapsSelector'><option value='0'>...</option></select>";
        ((Element)object).setInnerRML(string10);
        Element element3 = this.getMapDropdown();
        element3.setInnerRML((String)var8_13);
    }

    String generateOption(String string2, String string3, boolean bl2) {
        return this.generateOption(string2, string3, bl2, null, false);
    }

    String generateOption(String string2, String string3, boolean bl2, Integer n2, boolean bl3) {
        String string4 = "";
        if (bl2) {
            string4 = string4 + " selected='selected'";
        }
        String string5 = this.root.htmlString(string3);
        String string6 = "";
        if (n2 != null) {
            string6 = string6 + " style='color:" + f.h(n2) + ";'";
        }
        if (bl3) {
            string6 = string6 + " class='disabled-option'";
        }
        if (string6 != null && !"".equals(string6)) {
            string5 = "<span " + string6 + ">" + string5 + "</span>";
        }
        return "<option value=" + this.root.escapedString(string2) + " " + string4 + ">" + string5 + "</option>";
    }

    Element getMapDropdown() {
        ElementDocument elementDocument = this.libRocket.c();
        Element element = elementDocument.findByClassName("mapsSelector");
        return element;
    }

    String getMapDropdownSelected() {
        return this.getMapDropdown().getAttribute("value");
    }

    void readInterfaceIntoNetworkSettings() {
        l l2 = l.B();
        if (l2.bX.C) {
            String string2 = this.getMapDropdownSelected();
            if (string2 == null) {
                string2 = "<No Map>";
            }
            l2.bX.ay.b = string2;
            int n2 = 0;
            l2.bX.ay.a = ai.values()[n2];
        }
    }

    public void multiplayerStart() {
        l l2 = l.B();
        if (l2.bX.C) {
            if (l2.bX.ay.a == ai.a) {
                String string2;
                l2.bX.az = string2 = "maps/skirmish/" + l2.bX.ay.b;
            } else if (l2.bX.ay.a == ai.b) {
                l2.bX.az = "/SD/rusted_warfare_maps/" + l2.bX.ay.b;
            } else if (l2.bX.ay.a == ai.c) {
                l2.bX.az = null;
            } else {
                this.libRocket.c("Error: No map type selected");
                return;
            }
            if (l2.bX.ay.b == null || "".equals(l2.bX.ay.b) || l2.bX.ay.b.equals("<No Map>")) {
                this.libRocket.c("Error: No map selected");
                return;
            }
            l2.bX.ae();
        } else if (l2.bX.H) {
            l2.bX.k("-start");
        } else {
            l.b("startNetButton.setOnClickListener", "Clicked but not server or proxy controller");
        }
    }

    public void battleroomSetup() {
        l l2 = l.B();
        this.lastPlayerTable = null;
        this.refreshUI();
        this.root.refreshChat();
        ElementDocument elementDocument = this.libRocket.getActiveDocument();
        if (elementDocument != null && l2.bX.F) {
            elementDocument.addClass("singlePlayer");
        }
        l2.bX.as();
    }

    public void refreshUI() {
        Object object2;
        l l2 = l.B();
        Element element = this.libRocket.getActiveElementById("infoDiv");
        if (element == null) {
            l.e("refreshUI: infoTextElement==null");
            return;
        }
        ElementDocument elementDocument = this.libRocket.getActiveDocument();
        boolean bl2 = l2.bX.C || l2.bX.H;
        boolean bl3 = l2.bX.C;
        boolean bl4 = !bl2 && !l2.bX.ay.m;
        for (Object object2 : elementDocument.findElementsByClassName("forHostOnly")) {
            ((Element)object2).show(bl2);
        }
        for (Object object2 : elementDocument.findElementsByClassName("forLocalHostOnly")) {
            ((Element)object2).show(bl3);
        }
        for (Object object2 : elementDocument.findElementsByClassName("forUnlockedTeamsNonHost")) {
            ((Element)object2).show(bl4);
        }
        if (l2.P()) {
            for (Object object2 : elementDocument.findElementsByClassName("forRealNetworkOnly")) {
                ((Element)object2).show(false);
            }
        }
        Iterator iterator = l2.bX.at();
        element.compareAndSetText((String)((Object)iterator));
        object2 = l2.bX.av();
        if (l2.bX.ay.a == ai.c) {
            object2 = "saves/" + l2.bX.ay.b;
        }
        Element element2 = this.libRocket.getActiveElementById("mapImage");
        if (l2.bX.v) {
            element2.hide();
        }
        String string2 = element2.getAttribute("src");
        if (object2 == null) {
            if (!"".equals(string2)) {
                element2.setAttribute("src", "");
            }
        } else {
            String string3 = this.root.getMapThumbnail((String)object2);
            if (string3 == null) {
                string3 = "";
            }
            if (!string3.equals(string2)) {
                element2.setAttribute("src", string3);
            }
        }
        this.refreshPlayerTable();
    }

    public void refreshPlayerTable() {
        Root$TableData root$TableData = this.getPlayerTable();
        String string2 = "playersDiv";
        if (this.lastPlayerTable != null) {
            if (this.lastPlayerTable.same(root$TableData, false)) {
                return;
            }
            if (this.lastPlayerTable.same(root$TableData, true)) {
                this.root.updateTableTextOnly(string2, root$TableData, this.lastPlayerTable);
                return;
            }
        }
        this.root.refreshTable(string2, root$TableData);
        this.lastPlayerTable = root$TableData;
    }

    public Root$TableData getPlayerTable() {
        Root$TableRow root$TableRow;
        Object object;
        l l2 = l.B();
        Root$TableData root$TableData = new Root$TableData();
        ArrayList arrayList = root$TableData.rows;
        int n2 = -1;
        int n3 = 0;
        ArrayList arrayList2 = n.a(true);
        for (Object object2 : arrayList2) {
            if (object2 == null) continue;
            if (n2 != -1 && n2 != ((n)object2).r) {
                ++n3;
            }
            n2 = ((n)object2).r;
        }
        n2 = -1;
        for (Object object2 : arrayList2) {
            Object object3;
            if (object2 == null) continue;
            if (n2 != -1 && n2 != ((n)object2).r && n3 <= 3) {
                object = new Root$TableRow();
                for (int i2 = 0; i2 < 4; ++i2) {
                    object3 = ((Root$TableRow)object).addCell("");
                    ((Root$TableCell)object3).addClass("spacer");
                }
                arrayList.add(object);
            }
            n2 = ((n)object2).r;
            object = "unnamed";
            if (((n)object2).v != null) {
                object = ((n)object2).v;
            }
            String string2 = ((n)object2).z();
            object3 = Integer.toString(((n)object2).k + 1);
            boolean bl2 = ((n)object2).b();
            if (bl2) {
                object3 = "S";
            }
            if (!bl2 && ((n)object2).A != null && ((n)object2).A != l2.bX.ay.g) {
                object3 = (String)object3 + " - " + l2.bX.d(((n)object2).A);
            }
            String string3 = ((n)object2).h();
            root$TableRow = new Root$TableRow();
            Root$TableCell root$TableCell = root$TableRow.addCell((String)object);
            if (((n)object2).C != null) {
                root$TableCell.color = n.i(((n)object2).C);
            }
            if (object2 == l2.bX.z) {
                root$TableCell.addClass("boldText");
            }
            Root$TableCell root$TableCell2 = root$TableRow.addCell((String)object3);
            root$TableCell2.color = ((n)object2).M();
            Root$TableCell root$TableCell3 = root$TableRow.addCell(string3);
            root$TableCell3.color = n.i(((n)object2).r);
            root$TableRow.addCell(string2);
            root$TableRow.setLibrocketOnClick("mp.showPlayerConfig('" + ((n)object2).k + "')");
            arrayList.add(root$TableRow);
        }
        if (!l2.bX.C && l2.bX.S == null) {
            Object object2;
            arrayList.clear();
            Object object4 = "Connecting...";
            if (l2.bX.aM.size() == 0) {
                object4 = "Disconnected";
            }
            root$TableRow = new Root$TableRow();
            root$TableRow.addCell((String)object4);
            object2 = root$TableRow.addCell("");
            object = root$TableRow.addCell("");
            root$TableRow.addCell("");
            arrayList.add(root$TableRow);
        }
        return root$TableData;
    }

    public void showSetTeamsDialog() {
        l l2 = l.B();
        ElementDocument elementDocument = this.root.createAndShowPopup("battleroom_setTeams.rml", null, "Set Teams");
        if (elementDocument != null) {
            // empty if block
        }
    }

    public void showPlayerConfigForSelf() {
        l l2 = l.B();
        if (l2.bX.z != null) {
            this.showPlayerConfig("" + l2.bX.z.k);
        }
    }

    public void showPlayerConfig(String string2) {
        l l2 = l.B();
        ScriptEngine.Action action = this.scriptEngine.addRunnableToQueue(new Multiplayer$1(this, string2));
    }

    public void showPlayerConfigNow(String string2) {
        l l2 = l.B();
        int n2 = Integer.parseInt(string2);
        n n3 = n.k(n2);
        if (n3 == null) {
            this.root.logWarn("showPlayerConfig: " + string2 + "==null");
            return;
        }
        if (!l2.bX.aw() && (l2.bX.z != n3 || l2.bX.ay.m)) {
            return;
        }
        ElementDocument elementDocument = this.root.createAndShowPopup("battleroom_player.rml", n3, n3.v);
        if (elementDocument != null) {
            Element element = elementDocument.getElementById("team_id");
            Element element2 = elementDocument.getElementById("spawnPoint");
            Element element3 = elementDocument.getElementById("allyTeam");
            Element element4 = elementDocument.getElementById("aiDifficulty");
            Element element5 = elementDocument.getElementById("startingUnits");
            Element element6 = elementDocument.getElementById("playerColor");
            Element element7 = elementDocument.getElementById("playerOverridesSection");
            Element element8 = elementDocument.getElementById("aiDifficultySelection");
            if (!l.o("sd")) {
                this.setupStartingUnitDropDown(element5, true);
                this.setupPlayerColorDropDown(element6, true, true, n3);
            } else {
                l.e("sd");
            }
            element.setValue("" + n3.k);
            String string3 = "" + (n3.k + 1);
            if (n3.b()) {
                string3 = "-2";
            }
            element2.setValue(string3);
            if (n3.u) {
                element3.setValue("" + (n3.r + 1));
            } else {
                element3.setValue("fromSpawn2");
            }
            if (element7 == null) {
                throw new RuntimeException("playerOverridesSection==null");
            }
            if (!l2.bX.C) {
                element7.hide();
            }
            if (element8 == null) {
                throw new RuntimeException("aiDifficultySelection==null");
            }
            if (!l.o("s1")) {
                if (n3.w) {
                    if (n3.z == null) {
                        element4.setValue("-99");
                    } else {
                        element4.setValue("" + n3.z);
                    }
                } else {
                    element8.hide();
                }
            } else {
                l.e("s1");
            }
            if (!l.o("s2")) {
                if (n3.A == null) {
                    element5.setValue("-99");
                } else {
                    l.e("startingUnitOverride: " + n3.A);
                    element5.setValue("" + n3.A);
                }
            } else {
                l.e("s2");
            }
            if (!l.o("s3")) {
                if (n3.C == null) {
                    element6.setValue("-99");
                } else {
                    l.e("playerColor: " + n3.C);
                    element6.setValue("" + n3.C);
                }
            } else {
                l.e("s3");
            }
        }
    }

    public void teamsSet_apply() {
        l l2 = l.B();
        if (!l2.bX.C) {
            l.e("Not server");
            return;
        }
        l.e("playerConfig_kick");
        String string2 = this.libRocket.c().getElementById("teamLayout").getValue();
        if ("2t".equalsIgnoreCase(string2)) {
            l2.bX.a(am.a);
        } else if ("3t".equalsIgnoreCase(string2)) {
            l2.bX.a(am.b);
        } else if ("FFA".equalsIgnoreCase(string2)) {
            l2.bX.a(am.c);
        } else if ("spectators".equalsIgnoreCase(string2)) {
            l2.bX.a(am.d);
        } else {
            l.b("teamsSet_apply: unknown layout: " + string2);
        }
        this.refreshUI();
    }

    public void playerConfig_kick() {
        l l2 = l.B();
        l.e("playerConfig_kick");
        String string2 = this.libRocket.c().getElementById("team_id").getValue();
        int n2 = Integer.parseInt(string2);
        n n3 = n.k(n2);
        if (n3 == null) {
            this.root.logWarn("playerConfig_kick: " + string2 + "==null");
            return;
        }
        l2.bX.e(n3);
    }

    public void playerConfig_apply() {
        int n2;
        Integer n3;
        boolean bl2;
        int n4;
        l l2 = l.B();
        l.e("playerConfig_kick");
        String string2 = this.libRocket.c().getElementById("team_id").getValue();
        int n5 = Integer.parseInt(string2);
        n n6 = n.k(n5);
        if (n6 == null) {
            this.root.logWarn("playerConfig_apply: " + string2 + "==null");
            return;
        }
        ElementDocument elementDocument = this.libRocket.c();
        Element element = elementDocument.getElementById("spawnPoint");
        Element element2 = elementDocument.getElementById("allyTeam");
        Element element3 = elementDocument.getElementById("aiDifficulty");
        Element element4 = elementDocument.getElementById("startingUnits");
        Element element5 = elementDocument.getElementById("playerColor");
        String string3 = element.getValue();
        String string4 = element2.getValue();
        int n7 = Integer.valueOf(string3) - 1;
        boolean bl3 = false;
        if (n7 == -3) {
            bl3 = true;
        } else {
            if (n7 < 0) {
                n7 = 1;
            }
            if (n7 > n.c - 1) {
                n7 = n.c - 1;
            }
        }
        boolean bl4 = false;
        if (bl3) {
            n4 = -3;
            bl2 = true;
        } else if (string4.equals("fromSpawn2")) {
            n4 = n7 % 2;
            n6.u = false;
            bl2 = true;
        } else {
            bl2 = false;
            n4 = n6.r;
            try {
                n4 = Integer.valueOf(string4) - 1;
            }
            catch (NumberFormatException numberFormatException) {
                numberFormatException.printStackTrace();
            }
            n6.u = true;
        }
        if (n6.r != n4) {
            if (l2.bX.C) {
                bl4 = true;
            } else if (l2.bX.H || l2.bX.z == n6) {
                bl4 = true;
            } else {
                l.b("row.setOnClickListener", "Clicked but not server or proxy controller");
            }
        }
        try {
            if (n6.k != n7) {
                if (l2.bX.C) {
                    bl4 = false;
                    l2.bX.a(n6, n7);
                    n6.r = n4;
                } else if (l2.bX.H || l2.bX.z == n6) {
                    bl4 = false;
                    int n8 = n4;
                    if (bl2) {
                        n8 = -1;
                    }
                    l2.bX.a(n6, n7, (Integer)n8);
                } else {
                    l.b("row.setOnClickListener", "Clicked but not server or proxy controller");
                }
            }
        }
        catch (NumberFormatException numberFormatException) {
            numberFormatException.printStackTrace();
        }
        if (n6.w && n6.z != (n3 = (n2 = element3.getValueAsInt(-99).intValue()) == -99 ? null : Integer.valueOf(n2))) {
            if (l2.bX.C) {
                n6.z = n3;
            } else {
                l.e("aiDifficultyOverride: not server or proxy controller");
            }
        }
        int n9 = element4.getValueAsInt(-99);
        l.e("startingUnits now: " + n9);
        n3 = n9 == -99 ? null : Integer.valueOf(n9);
        if (n6.A != n3) {
            if (l2.bX.C) {
                n6.A = n3;
            } else {
                l.e("startingUnitOverride: not server or proxy controller");
            }
        }
        int n10 = element5.getValueAsInt(-99);
        l.e("playerColor now: " + n10);
        Integer n11 = n10 == -99 ? null : Integer.valueOf(n10);
        if (n6.C != n11) {
            if (l2.bX.C) {
                n6.C = n11;
            } else {
                l.e("colorOverride: not server or proxy controller");
            }
        }
        if (bl4) {
            if (l2.bX.C) {
                n6.r = n4;
            } else if (bl2) {
                l2.bX.b(n6, -1);
            } else {
                l2.bX.b(n6, n4);
            }
        }
        l2.bX.f();
        l2.bX.M();
        this.refreshUI();
    }

    public void disconnect(String string2) {
        l l2 = l.B();
        l2.bX.b(string2);
    }

    public void multiplayerBackPrompt() {
        String string2 = com.corrodinggames.rts.gameFramework.h.a.a("menus.ingame.multiplayerClose.title", new Object[0]);
        String string3 = "What would you like to do?";
        String string4 = com.corrodinggames.rts.gameFramework.h.a.a("menus.ingame.multiplayerClose.disconnectButton", new Object[0]) + ":";
        string4 = string4 + "closePopup(); mp.disconnect('exited'); back();";
        boolean bl2 = true;
        this.root.showPopup(string2, string3, bl2, string4, null);
    }

    public void surrenderPrompt() {
        String string2 = com.corrodinggames.rts.gameFramework.h.a.a("menus.ingame.surrender.title", new Object[0]);
        String string3 = com.corrodinggames.rts.gameFramework.h.a.a("menus.ingame.surrender.message", new Object[0]);
        String string4 = com.corrodinggames.rts.gameFramework.h.a.a("menus.ingame.surrender.surrenderButton", new Object[0]) + ":";
        string4 = string4 + "closePopup(); mp.surrender();";
        boolean bl2 = true;
        this.root.showPopup(string2, string3, bl2, string4, null);
    }

    public void surrender() {
        l.e("Surrender requested");
        this.root.sendChatMessage("-surrender");
    }

    public void multiplayerExitPrompt() {
        String string2 = com.corrodinggames.rts.gameFramework.h.a.a("menus.ingame.multiplayerClose.titleDisconnect", new Object[0]);
        String string3 = com.corrodinggames.rts.gameFramework.h.a.a("menus.ingame.multiplayerClose.messageDisconnect", new Object[0]);
        l l2 = l.B();
        String string4 = com.corrodinggames.rts.gameFramework.h.a.a("menus.ingame.multiplayerClose.disconnectButton", new Object[0]) + ":";
        string4 = string4 + "closePopup(); mp.disconnect('exited'); showMainMenu();";
        String string5 = null;
        if (l2.bX.C) {
            string2 = com.corrodinggames.rts.gameFramework.h.a.a("menus.ingame.multiplayerClose.title", new Object[0]);
            string3 = com.corrodinggames.rts.gameFramework.h.a.a("menus.ingame.multiplayerClose.messageEndGame", new Object[0]);
            string4 = com.corrodinggames.rts.gameFramework.h.a.a("menus.ingame.exitGame", new Object[0]) + ":";
            string4 = string4 + "closePopup(); mp.disconnect('exited'); showMainMenu();";
            string5 = com.corrodinggames.rts.gameFramework.h.a.a("menus.ingame.multiplayerClose.returnToBattleroom", new Object[0]) + ":";
            string5 = string5 + "closePopup(); mp.sendReturnToBattleroomEvent();";
        }
        boolean bl2 = true;
        this.root.showPopup(string2, string3, bl2, string4, string5);
    }

    public void sendReturnToBattleroomEvent() {
        l.e("mp.sendReturnToBattleroomEvent()");
        l l2 = l.B();
        l2.bX.ag();
        l2.bS.u = false;
    }

    public void addAI() {
        l l2 = l.B();
        if (l2.bX.C) {
            l2.bX.ap();
        } else if (l2.bX.H) {
            l2.bX.k("-addai");
        } else {
            this.root.logWarn("addAI(): Clicked but not server or proxy controller");
        }
    }

    public String _getRandomDefaultPlayerName() {
        return "Unnamed" + f.a(0, 999);
    }

    public void loadUsername() {
        l.e("mp.loadUsername()");
        l l2 = l.B();
        String string2 = l2.bQ.lastNetworkPlayerName;
        Element element = this.libRocket.getActiveElementById("username");
        String string3 = com.corrodinggames.rts.gameFramework.o.a.a().c();
        l.e("steamName:" + string3);
        if (string3 != null && string2 == null) {
            string2 = string3;
        }
        if (string2 == null || "".equals(string2)) {
            string2 = this._getRandomDefaultPlayerName();
        }
        element.loadCharsetIfNeeded(string2);
        element.setAttribute("value", string2);
    }

    public void getUsernameFromInterface() {
        l l2 = l.B();
        String string2 = this.root.getValueById("username");
        if (string2 == null) {
            l.b("getUsernameFromInterface: Cannot find username");
            return;
        }
        string2 = string2.trim();
        l.e("set username:" + string2);
        if (string2.equals("")) {
            string2 = this._getRandomDefaultPlayerName();
        }
        l2.bX.a(string2);
    }

    public void gameOptionsGet() {
        this.gameOptionsGetOrPush(false);
    }

    public void gameOptionsPush() {
        this.gameOptionsGetOrPush(true);
    }

    public void gameOptionsRefreshTypes() {
        l l2 = l.B();
        ElementDocument elementDocument = this.libRocket.c();
        if (this.useMapDropdown) {
            this.updateMapDropdown(elementDocument, "mapsSelector", "typeSelector");
        }
    }

    public void gameOptionsGetOrPush(boolean bl2) {
        l l2 = l.B();
        ElementDocument elementDocument = this.libRocket.c();
        Element element = elementDocument.getElementById("fogMode");
        Element element2 = elementDocument.getElementById("startingCredits");
        Element element3 = elementDocument.getElementById("incomeMultiplier");
        Element element4 = elementDocument.getElementById("noNukes");
        Element element5 = elementDocument.getElementById("sharedControl");
        Element element6 = elementDocument.getElementById("aiDifficulty");
        Element element7 = elementDocument.getElementById("startingUnits");
        if (!bl2) {
            this.setupStartingUnitDropDown(element7, false);
        }
        Element element8 = elementDocument.getElementById("typeSelector");
        Element element9 = this.getMapDropdown();
        if (!bl2) {
            if (l2.bX.ay.a == null) {
                l.e("gameOptionsGetOrPush: game.network.setup.currentType==null");
            } else {
                element8.setValue("" + l2.bX.ay.a.ordinal());
            }
            if (this.useMapDropdown) {
                this.updateMapDropdown(elementDocument, "mapsSelector", "typeSelector");
                element9 = this.getMapDropdown();
                l.e("new currentMapSelection=" + l2.bX.ay.b);
                element9.setValue("" + l2.bX.ay.b);
            }
            element8 = elementDocument.getElementById("typeSelector");
            element.setValue("" + l2.bX.ay.d);
            element2.setValue("" + l2.bX.ay.c);
            element7.setValue("" + l2.bX.ay.g);
            l2.bX.ay.e = true;
            element4.setCheckbox(l2.bX.ay.i);
            element5.setCheckbox(l2.bX.ay.l);
            element3.setValue("" + f.a(l2.bX.ay.h, 1) + "x");
            element6.setValue("" + l2.bX.ay.f);
            return;
        }
        ah ah2 = l2.bX.e();
        if (ah2 != null) {
            String string2 = null;
            if (this.useMapDropdown && (string2 = element9.getValue()) == null) {
                l.e("gameOptionsGetOrPush: mapDropdownSelected==null");
                string2 = "<No Map>";
            }
            int n2 = element8.getValueAsInt(0);
            ai ai2 = ah2.a;
            ah2.a = ai.values()[n2];
            if (this.useMapDropdown) {
                ah2.b = string2;
            } else if (ai2 != ah2.a) {
                ah2.b = null;
            }
            ah2.d = element.getValueAsInt(null);
            ah2.c = element2.getValueAsInt(null);
            String string3 = element3.getValue();
            string3 = string3.replace("x", "");
            float f2 = 1.0f;
            try {
                f2 = Float.parseFloat(string3);
            }
            catch (NumberFormatException numberFormatException) {
                numberFormatException.printStackTrace();
            }
            ah2.h = f2;
            ah2.i = element4.getCheckbox();
            ah2.l = element5.getCheckbox();
            ah2.f = element6.getValueAsInt(null);
            ah2.g = element7.getValueAsInt(1);
            l2.bX.a(ah2);
        }
    }

    public void closeBattleroomIfOpen() {
        l l2 = l.B();
        Element element = this.libRocket.getActiveElementById("battleroomPage");
        if (element == null) {
            l.e("closeBattleroomIfOpen: battleroomPage==null");
            return;
        }
        this.libRocket.backToLastDocument();
    }

    public void reinviteAsk() {
        String string2 = com.corrodinggames.rts.gameFramework.h.a.a("menus.ingame.multiplayerReinvite.title", new Object[0]);
        String string3 = "While in-game you can only reinvite players who were in-game before but dropped out";
        String string4 = "reInvite:";
        string4 = string4 + "closePopup(); mp.showSteamInviteDialog();";
        boolean bl2 = true;
        this.root.showPopup(string2, string3, bl2, string4, null);
    }

    public void showSteamInviteDialog() {
        com.corrodinggames.rts.gameFramework.o.a a2 = com.corrodinggames.rts.gameFramework.o.a.a();
        a2.g();
    }

    public void setMapFromPopup(String string2) {
        if (!this.isInControlOfServer()) {
            String string3 = this.root.getMapNameFromPath(string2);
            String string4 = "clicked on '" + string3 + "'";
            this.root.sendChatMessage(string4);
            this.root.closePopup();
            return;
        }
        l l2 = l.B();
        ah ah2 = l2.bX.e();
        if (ah2 != null) {
            String string5 = string2;
            if (!string5.contains("MOD|")) {
                string5 = f.k(string5);
            }
            ah2.b = string5;
            l2.bX.a(ah2);
        }
        this.root.closePopup();
    }

    public void showMapSelect() {
        String string2 = this.root.getModeMapPath(null, null);
        this.root.showMapPopup(string2, "mp.setMapFromPopup");
    }

    public boolean isInControlOfServer() {
        l l2 = l.B();
        boolean bl2 = l2.bX.C || l2.bX.H;
        return bl2;
    }

    public void askPassword() {
        l.e("mp.askPassword()");
        l l2 = l.B();
        String string2 = "Password Required";
        String string3 = "This server requires a password to join";
        String string4 = "";
        this.root.showInputPopupNonClose(string2, string3, string4, "Close:mp.cancelPaswordAsk()", "[onenter]Join:mp.askPasswordEntered(getPopupText())");
    }

    public void askPasswordEntered(String string2) {
        l.e("mp.askPasswordEntered()");
        l l2 = l.B();
        l2.bX.n = string2;
        l2.bX.X();
        this.root.closePopup();
    }

    public void cancelPaswordAsk() {
        l l2 = l.B();
        if (l2.bX.C) {
            this.root.logWarn("cancelPaswordAsk: we are the server");
        } else {
            l2.bX.b("Cancel password");
            this.closeBattleroomIfOpen();
        }
        this.root.closePopup();
    }

    public void setupStartingUnitDropDown(Element element, boolean bl2) {
        String string2 = "";
        if (bl2) {
            string2 = string2 + this.generateOption("-99", com.corrodinggames.rts.gameFramework.h.a.a("menus.settings.option.default", new Object[0]), false);
        }
        for (Multiplayer$DropdownOption multiplayer$DropdownOption : this.getStartingUnitOptions()) {
            string2 = string2 + this.generateOption(multiplayer$DropdownOption.key, multiplayer$DropdownOption.value, false);
        }
        element.setInnerRML(string2);
    }

    public void setupPlayerColorDropDown(Element element, boolean bl2, boolean bl3, n n2) {
        l l2 = l.B();
        String string2 = "";
        if (bl2) {
            string2 = string2 + this.generateOption("-99", com.corrodinggames.rts.gameFramework.h.a.a("menus.settings.option.default", new Object[0]), false);
        }
        for (int i2 = 0; i2 < 10; ++i2) {
            boolean bl4 = false;
            if (bl3 && l2.bX.a(i2, n2)) {
                bl4 = true;
            }
            String string3 = n.j(i2);
            string3 = al.d(string3);
            int n3 = i2;
            int n4 = i2;
            if (bl4) {
                string3 = string3 + " (used)";
                n3 = -7829368;
                n4 = -99;
            }
            string2 = string2 + this.generateOption("" + n4, string3, false, n.i(n3), bl4);
        }
        element.setInnerRML(string2);
    }

    public ArrayList getStartingUnitOptions() {
        l l2 = l.B();
        ArrayList<Multiplayer$DropdownOption> arrayList = new ArrayList<Multiplayer$DropdownOption>();
        for (Integer n2 : l2.bX.i()) {
            String string2 = l2.bX.d(n2);
            arrayList.add(new Multiplayer$DropdownOption(n2.toString(), string2));
        }
        return arrayList;
    }
}

