(function () {
"use strict";

const LOGIN = "/main/login-consulente.html";
let sessionCache = null;

function roleOf(profile) {
    return String(profile?.ruolo || "consulente").toLowerCase();
}

function goLogin() {
    const back = encodeURIComponent(
        window.location.pathname +
        window.location.search +
        window.location.hash
    );
    window.location.replace(`${LOGIN}?return=${back}`);
}

function injectBadge(session) {
    if (document.getElementById("credipass-auth-badge")) return;

    const el = document.createElement("div");
    el.id = "credipass-auth-badge";
    el.style.cssText =
        "position:fixed;top:10px;right:10px;z-index:50000;" +
        "display:flex;align-items:center;gap:8px;background:#fff;" +
        "border:1px solid #dfe5ec;border-left:4px solid #C99700;" +
        "box-shadow:0 5px 18px rgba(0,0,0,.15);border-radius:9px;" +
        "padding:8px 10px;font-family:Poppins,Arial,sans-serif;font-size:10px;";

    el.innerHTML = `
        <div style="line-height:1.25;max-width:220px">
            <div style="font-weight:800;color:#002d72">${session.user.email || ""}</div>
            <div style="font-size:9px;color:#7a838c">${String(session.profile.ruolo || "consulente").toUpperCase()}</div>
        </div>
        ${session.isAdmin ? `
            <a href="/main/gestione-consulenti.html"
               title="Gestione consulenti"
               style="color:#002d72;text-decoration:none;font-size:14px;padding:3px">
                <i class="fas fa-users-cog"></i>
            </a>` : ""}
        <button id="credipass-auth-logout" type="button"
                title="Esci"
                style="border:0;background:#eef3f8;color:#002d72;border-radius:6px;padding:6px 8px;cursor:pointer">
            <i class="fas fa-sign-out-alt"></i>
        </button>
    `;

    document.body.appendChild(el);

    document.getElementById("credipass-auth-logout")
        ?.addEventListener("click", async () => {
            await firebase.auth().signOut();
            window.location.replace(LOGIN);
        });
}

async function ensureProfile(user) {
    const fn =
        firebase.app()
            .functions("us-central1")
            .httpsCallable("ensureConsultantProfile");

    const result = await fn({});
    const profile = result?.data?.profile || {};

    return {
        user,
        profile,
        isAdmin: roleOf(profile) === "admin"
    };
}

async function guard(options = {}) {
    if (sessionCache) {
        if (options.adminOnly && !sessionCache.isAdmin) {
            window.location.replace("/");
            throw new Error("Accesso riservato all'amministratore.");
        }
        return sessionCache;
    }

    await firebase.auth().setPersistence(
        firebase.auth.Auth.Persistence.LOCAL
    );

    const user = await new Promise((resolve, reject) => {
        const unsubscribe =
            firebase.auth().onAuthStateChanged(
                u => {
                    unsubscribe();
                    resolve(u);
                },
                reject
            );
    });

    if (!user) {
        goLogin();
        throw new Error("Utente non autenticato.");
    }

    if (!user.emailVerified) {
        try {
            await user.sendEmailVerification();
        } catch (_) {}

        await firebase.auth().signOut();
        window.location.replace(
            `${LOGIN}?verify=1&email=${encodeURIComponent(user.email || "")}`
        );
        throw new Error("Email non verificata.");
    }

    sessionCache = await ensureProfile(user);

    if (sessionCache.profile.attivo === false) {
        await firebase.auth().signOut();
        goLogin();
        throw new Error("Account disattivato.");
    }

    if (options.adminOnly && !sessionCache.isAdmin) {
        window.location.replace("/");
        throw new Error("Accesso riservato all'amministratore.");
    }

    injectBadge(sessionCache);
    return sessionCache;
}

async function practiceIsAccessible(data = {}) {
    const s = sessionCache || await guard();
    if (s.isAdmin) return true;

    const owner =
        data.consulente_uid ||
        data.workspace_uid ||
        data.owner_uid ||
        "";

    return owner === s.user.uid;
}

window.CredipassAuth = {
    guard,
    getSession: () => sessionCache || guard(),
    practiceIsAccessible
};
})();
