/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.librocket.scripts;

import com.Element;
import com.ElementDocument;
import com.corrodinggames.librocket.scripts.Mods$1;
import com.corrodinggames.librocket.scripts.Root;
import com.corrodinggames.librocket.scripts.ScriptContext;
import com.corrodinggames.rts.game.units.custom.ag;
import com.corrodinggames.rts.gameFramework.f;
import com.corrodinggames.rts.gameFramework.i.b;
import com.corrodinggames.rts.gameFramework.l;
import com.corrodinggames.rts.gameFramework.o.a;
import java.util.ArrayList;
import java.util.Locale;

public class Mods
extends ScriptContext {
    Root root;
    Runnable updateModsRunnable = new Mods$1(this);
    int checkWorkshopSkip = 0;

    Mods(Root root) {
        this.root = root;
    }

    public a getSteam() {
        a a2 = a.a();
        if (!a2.e()) {
            a2.h();
            return null;
        }
        return a2;
    }

    public void openWorkshop() {
        l l2 = l.B();
        a a2 = this.getSteam();
        if (a2 == null) {
            return;
        }
        a2.m();
    }

    public void uploadModAsk(String string2) {
        l l2 = l.B();
        if (l2.n()) {
            this.root.showAlert("Workshop uploading is disabled in BETA versions to ensure compatibility for others. Please test and upload this mod with a released version or wait till beta finishes.");
            return;
        }
        b b2 = l2.bZ.c(string2);
        if (b2 == null) {
            this.root.showAlert("Could not find mod:" + string2);
            return;
        }
        a a2 = this.getSteam();
        if (a2 == null) {
            return;
        }
        String string3 = "Are you sure you want to upload to the workshop?";
        String string4 = "";
        String string5 = "[onenter]Upload:";
        string5 = string5 + "closePopup(); mods.uploadMod('" + string2 + "');";
        boolean bl2 = true;
        this.root.showPopup(string3, string4, bl2, string5, null);
    }

    public void uploadMod(String string2) {
        l l2 = l.B();
        b b2 = l2.bZ.c(string2);
        if (b2 == null) {
            this.root.showAlert("Could not find mod:" + string2);
            return;
        }
        a a2 = this.getSteam();
        if (a2 == null) {
            return;
        }
        if (b2.k == 0L) {
            a2.b(b2);
            return;
        }
        String string3 = "Changes.";
        a2.a(b2, false, string3);
    }

    public void viewMod(String string2) {
        l l2 = l.B();
        b b2 = l2.bZ.c(string2);
        if (b2 == null) {
            this.root.showAlert("Could not find mod:" + string2);
            return;
        }
        a a2 = this.getSteam();
        if (a2 == null) {
            return;
        }
        a2.a(b2);
    }

    public void deleteModPopup(String string2) {
        l l2 = l.B();
        b b2 = l2.bZ.c(string2);
        if (b2 == null) {
            this.root.showAlert("Could not find mod:" + string2);
            return;
        }
        String string3 = "";
        String string4 = "Are you sure you want to permanently delete '" + b2.b() + "'? (Note: You can instead disable the mod by unticking it)";
        String string5 = "[onenter]Delete:";
        string5 = string5 + "closePopup(); mods.deleteMod('" + string2 + "');";
        boolean bl2 = true;
        this.root.showPopup(string3, string4, bl2, string5, null);
    }

    public void deleteMod(String string2) {
        l l2 = l.B();
        b b2 = l2.bZ.c(string2);
        if (b2 == null) {
            this.root.showAlert("Could not find mod:" + string2);
            return;
        }
        boolean bl2 = b2.u();
        if (bl2) {
            this.reloadModData();
        } else {
            this.root.showAlert("Error failed to delete mod");
        }
    }

    public void setModFilter(String string2) {
        ElementDocument elementDocument = this.libRocket.getActiveDocument();
        if (elementDocument == null) {
            l.e("loadMods: No Active Document");
            return;
        }
        elementDocument.setMetadata("modFilter", string2);
        this.applyModFilter();
    }

    public void applyModFilter() {
        Element element4;
        l l2 = l.B();
        ElementDocument elementDocument = this.libRocket.getActiveDocument();
        if (elementDocument == null) {
            l.e("loadMods: No Active Document");
            return;
        }
        String string2 = (String)elementDocument.getMetadata("modFilter");
        Element element2 = elementDocument.getElementById("modList");
        if (element2 == null) {
            l.e("loadMods: Failed to find modList, wrong page?");
            return;
        }
        Element element3 = elementDocument.getElementById("onlyEnabledMods");
        boolean bl2 = element3.getCheckbox();
        ArrayList arrayList = element2.findElementsByClassName("modItem");
        if (string2 == null || string2.trim().equals("")) {
            string2 = null;
        }
        if (string2 != null) {
            string2 = string2.toLowerCase(Locale.ROOT).trim();
        }
        int n2 = 0;
        int n3 = 0;
        for (Element element4 : arrayList) {
            boolean bl3 = false;
            String string3 = element4.getAttribute("data_sessionid");
            int n4 = f.l(string3);
            b b2 = l2.bZ.a(n4);
            if (b2 == null) {
                l.e("Could not find mod with mod session id: " + n4);
            } else {
                if (string2 != null) {
                    boolean bl4 = false;
                    if (b2.a() != null && b2.a().toLowerCase(Locale.ROOT).contains(string2)) {
                        bl4 = true;
                    }
                    if (b2.e() != null && b2.e().toLowerCase(Locale.ROOT).contains(string2)) {
                        bl4 = true;
                    }
                    if (!bl4) {
                        bl3 = true;
                    }
                }
                if (bl2 && b2.f) {
                    bl3 = true;
                }
            }
            if (bl3) {
                ++n2;
                element4.compareAndAddClass("modItemFilteredOut");
                continue;
            }
            ++n3;
            element4.removeClass("modItemFilteredOut");
        }
        Object object = "";
        if (n2 > 0 && n3 == 0) {
            object = "< No mods found with active filter (" + n2 + " hidden) >";
        } else if (n2 > 0) {
            object = "< " + n2 + " mods hidden with active filter >";
        }
        element4 = elementDocument.getElementById("filterStatus");
        element4.setText((String)object);
    }

    public void updateMods() {
        ++this.checkWorkshopSkip;
        if (this.checkWorkshopSkip > 100) {
            this.checkWorkshopSkip = 0;
            a a2 = a.a();
            if (a2 != null) {
                a2.k();
            }
        }
    }

    public void refreshModList() {
        ElementDocument elementDocument = this.libRocket.getActiveDocument();
        if (elementDocument == null) {
            l.e("refreshModList: No Active Document");
            return;
        }
        l.e("refreshModList");
        Element element = elementDocument.getElementById("modTemplate");
        if (element == null) {
            l.e("refreshModList: Failed to find modTemplate, wrong page?");
            return;
        }
        l l2 = l.B();
        l2.bZ.d();
        this._rememberTempModSelection();
        this.loadMods();
        this._restoreTempModSelection();
    }

    public void loadMods() {
        Object object;
        l l2 = l.B();
        ArrayList arrayList = l2.bZ.k();
        ElementDocument elementDocument = this.libRocket.getActiveDocument();
        if (elementDocument == null) {
            l.e("loadMods: No Active Document");
            return;
        }
        l.e("loadMods");
        Element element = elementDocument.getElementById("modTemplate");
        Element element2 = elementDocument.getElementById("modList");
        if (element == null) {
            l.e("loadMods: Failed to find modTemplate, wrong page?");
            return;
        }
        if (element2 == null) {
            l.e("loadMods: Failed to find modList, wrong page?");
            return;
        }
        this.root.setDocumentUpdate(elementDocument, this.updateModsRunnable);
        String string2 = element.getInnerRML();
        String string3 = "";
        int n2 = 0;
        for (b b2 : arrayList) {
            String string4;
            object = string2;
            String string5 = b2.a();
            String string6 = "";
            object = ((String)object).replace("_NAME_", this.root.htmlString(string5));
            object = ((String)object).replace("_ID_", b2.e);
            String string7 = b2.R;
            if (string7 == null) {
                string7 = "";
            } else {
                string6 = string6 + " modItemError";
            }
            if (b2.v()) {
                string6 = string6 + " modItemCanBeDeleted";
            }
            if (b2.k == 0L) {
                if (!b2.y && !b2.z) {
                    string6 = string6 + " modItemCanBePublished";
                }
            } else {
                if (!b2.y) {
                    string6 = string6 + " modItemIsOwner";
                }
                string6 = string6 + " modItemIsPublished";
            }
            if (b2.A) {
                string6 = string6 + " modItemHasMaps";
            }
            if ((string4 = b2.l()) == null) {
                string4 = "";
            }
            String string8 = b2.e();
            object = ((String)object).replace("_ERROR_", this.root.htmlString(string7));
            object = ((String)object).replace("_MESSAGE_", this.root.htmlStringWithNewlines(string4));
            object = ((String)object).replace("_DESCRIPTION_", this.root.htmlString(string8));
            object = ((String)object).replace("_CLASS_", string6);
            object = ((String)object).replace("_SESSIONID_", "" + b2.d());
            ++n2;
            string3 = string3 + (String)object;
        }
        element2.setInnerRML(string3);
        element2.loadCharsetIfNeeded(string3);
        for (b b2 : arrayList) {
            object = elementDocument.getElementById(b2.e);
            if (object == null) {
                l.b("Could not find:" + b2.c);
                continue;
            }
            ((Element)object).setCheckbox(!b2.f);
        }
        this.applyModFilter();
    }

    public void saveMods() {
        this._saveModsCommon(true);
    }

    private void _rememberTempModSelection() {
        ElementDocument elementDocument = this.libRocket.getActiveDocument();
        l l2 = l.B();
        l.e("temp save");
        ArrayList arrayList = elementDocument.findElementsByClassName("modSelection");
        boolean bl2 = false;
        for (Element element : arrayList) {
            boolean bl3;
            String string2 = element.getId();
            if (string2.equals("_ID_")) continue;
            b b2 = l2.bZ.c(string2);
            if (b2 == null) {
                l.a("Could not find mod:" + element.getInnerRML());
                continue;
            }
            boolean bl4 = bl3 = !element.getCheckbox();
            if (b2.g != bl3) {
                bl2 = true;
            }
            b2.g = bl3;
            b2.h = true;
        }
    }

    private void _restoreTempModSelection() {
        ElementDocument elementDocument = this.libRocket.getActiveDocument();
        l l2 = l.B();
        l.e("temp restore");
        ArrayList arrayList = elementDocument.findElementsByClassName("modSelection");
        boolean bl2 = false;
        for (Element element : arrayList) {
            boolean bl3;
            String string2 = element.getId();
            if (string2 == null || string2.equals("") || string2.equals("_ID_")) continue;
            b b2 = l2.bZ.c(string2);
            if (b2 == null) {
                l.a("Could not find mod:" + element.getInnerRML() + " id:" + string2);
                continue;
            }
            if (!b2.h || b2.g == (bl3 = !element.getCheckbox())) continue;
            bl2 = true;
            element.setCheckbox(!b2.g);
        }
    }

    private void _saveModsCommon(boolean bl2) {
        boolean bl3 = false;
        ElementDocument elementDocument = this.libRocket.getActiveDocument();
        l l2 = l.B();
        l.e("savesMods");
        ArrayList arrayList = elementDocument.findElementsByClassName("modSelection");
        for (Element element : arrayList) {
            boolean bl4;
            String string2 = element.getId();
            if (string2.equals("_ID_")) continue;
            b b2 = l2.bZ.c(string2);
            if (b2 == null) {
                this.root.showAlert("Could not find mod:" + element.getInnerRML());
                continue;
            }
            boolean bl5 = bl4 = !element.getCheckbox();
            if (b2.f != bl4) {
                bl3 = true;
            }
            b2.f = bl4;
            b2.g = bl4;
        }
        if (bl3) {
            l.e("mod changes made");
        } else {
            l.e("no mod changes made");
        }
        l2.bZ.e();
        l2.bQ.save();
        if (bl2) {
            this._saveModsMessages(false);
        }
    }

    private void _saveModsMessages(boolean bl2) {
        l l2 = l.B();
        int n2 = l2.bZ.a(false);
        int n3 = l2.bZ.b();
        if (l2.bX.B) {
            l.e("savesMods: in network game");
            this.root.showAlert("You are currently in a network game, changes will be checked and applied on next game");
        } else if (ag.c(true)) {
            if (n2 == 0) {
                this.root.showAlert("Mod changes saved. Will be used in the next game.");
            } else if (bl2) {
                String string2 = "Note: " + n2 + " selected mods are still not loaded after reload";
                if (n3 > 0) {
                    string2 = "Warning: " + n3 + " selected mods had errors after reload";
                }
                this.root.showAlert(string2);
            } else {
                String string3 = "Reload needed";
                String string4 = "Mod selection saved. But " + n2 + " mod(s) aren't loaded. Load them now?";
                if (!l2.I()) {
                    string4 = string4 + " (This will end your current game).";
                }
                String string5 = "[onenter]Reload:";
                string5 = string5 + "closePopup(); mods.reloadModData();";
                boolean bl3 = true;
                this.root.showPopup(string3, string4, bl3, string5, null);
            }
        } else {
            l.e("Errors found");
        }
    }

    public void disableAllAsk() {
        String string2 = "Disable all mods?";
        String string3 = "";
        String string4 = "[onenter]Disable All:";
        string4 = string4 + "closePopup(); mods.disableAll();";
        boolean bl2 = true;
        this.root.showPopup(string2, string3, bl2, string4, null);
    }

    public void disableAll() {
        l l2 = l.B();
        l2.bZ.g();
        l2.bZ.e();
        l2.bQ.save();
        l2.bZ.l();
        this.loadMods();
    }

    public void reloadModDataAsk() {
        l l2 = l.B();
        if (l2.I()) {
            l.e("Menu active, reloading without asking");
            this.reloadModData();
            return;
        }
        String string2 = "Reload all mod data?";
        String string3 = "";
        string3 = string3 + "Warning! this will end your current game.";
        String string4 = "[onenter]Reload:";
        string4 = string4 + "closePopup(); mods.reloadModData();";
        boolean bl2 = true;
        this.root.showPopup(string2, string3, bl2, string4, null);
    }

    public void reloadModData() {
        l l2 = l.B();
        this._saveModsCommon(false);
        l2.bZ.l();
        this._saveModsMessages(true);
        this.loadMods();
    }
}

