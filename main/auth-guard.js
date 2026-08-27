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

    const wrapper = document.createElement("div");
    wrapper.id = "credipass-auth-badge";

    const nomeCompleto =
        [
            session.profile?.nome,
            session.profile?.cognome
        ]
        .filter(Boolean)
        .join(" ")
        .trim();

    const displayName =
        nomeCompleto ||
        session.user?.displayName ||
        session.user?.email ||
        "Consulente";

    const email =
        session.user?.email || "";

    const ruolo =
        String(
            session.profile?.ruolo || "consulente"
        ).toUpperCase();

    const iniziale =
        String(displayName || "C")
            .trim()
            .charAt(0)
            .toUpperCase();

    wrapper.style.cssText = [
        "position:relative",
        "display:flex",
        "align-items:center",
        "gap:8px",
        "width:245px",
        "max-width:100%",
        "padding:7px 9px",
        "border-radius:10px",
        "background:rgba(255,255,255,.08)",
        "border:1px solid rgba(255,255,255,.22)",
        "border-left:4px solid #C99700",
        "box-shadow:0 4px 12px rgba(0,0,0,.12)",
        "font-family:Poppins,Arial,sans-serif",
        "z-index:100",
        "flex-shrink:0"
    ].join(";");

    wrapper.innerHTML = `
        <button
            id="credipass-user-menu-button"
            type="button"
            aria-haspopup="true"
            aria-expanded="false"
            style="
                width:100%;
                border:0;
                background:transparent;
                padding:0;
                margin:0;
                color:#fff;
                display:flex;
                align-items:center;
                gap:8px;
                cursor:pointer;
                font-family:inherit;
                text-align:left;
                min-width:0;
            "
        >
            <div style="
                width:31px;
                height:31px;
                border-radius:50%;
                background:#C99700;
                color:#002d72;
                display:flex;
                align-items:center;
                justify-content:center;
                font-weight:800;
                flex-shrink:0;
                font-size:12px;
            ">
                ${iniziale}
            </div>

            <div style="
                min-width:0;
                flex:1;
                line-height:1.15;
            ">
                <div style="
                    font-size:10px;
                    font-weight:800;
                    color:#fff;
                    white-space:nowrap;
                    overflow:hidden;
                    text-overflow:ellipsis;
                ">
                    ${displayName}
                </div>

                <div style="
                    margin-top:2px;
                    font-size:8px;
                    font-weight:800;
                    color:#C99700;
                    letter-spacing:.4px;
                ">
                    ${ruolo}
                </div>
            </div>

            <i
                class="fas fa-chevron-down"
                id="credipass-user-menu-chevron"
                style="
                    font-size:9px;
                    color:#fff;
                    flex-shrink:0;
                    transition:transform .2s ease;
                "
            ></i>
        </button>

        <div
            id="credipass-user-menu"
            style="
                display:none;
                position:absolute;
                top:calc(100% + 8px);
                right:0;
                width:240px;
                background:#fff;
                border:1px solid #dfe5ec;
                border-radius:10px;
                box-shadow:0 12px 30px rgba(0,0,0,.18);
                overflow:hidden;
                z-index:50000;
            "
        >
            <div style="
                padding:12px 14px;
                background:#f7f9fc;
                border-bottom:1px solid #e8edf2;
            ">
                <div style="
                    color:#002d72;
                    font-size:10px;
                    font-weight:800;
                    white-space:nowrap;
                    overflow:hidden;
                    text-overflow:ellipsis;
                ">
                    ${displayName}
                </div>

                <div style="
                    margin-top:3px;
                    color:#7a838c;
                    font-size:8px;
                    white-space:nowrap;
                    overflow:hidden;
                    text-overflow:ellipsis;
                ">
                    ${email}
                </div>
            </div>

            <a
                href="/main/ricerca-clienti.html"
                style="
                    display:flex;
                    align-items:center;
                    gap:9px;
                    padding:11px 14px;
                    color:#002d72;
                    text-decoration:none;
                    font-size:9px;
                    font-weight:700;
                    border-bottom:1px solid #eef1f4;
                "
            >
                <i class="fas fa-folder-open"
                   style="width:14px;text-align:center;"></i>
                Archivio pratiche
            </a>

            ${session.isAdmin ? `
                <a
                    href="/main/gestione-consulenti.html"
                    style="
                        display:flex;
                        align-items:center;
                        gap:9px;
                        padding:11px 14px;
                        color:#002d72;
                        text-decoration:none;
                        font-size:9px;
                        font-weight:700;
                        border-bottom:1px solid #eef1f4;
                    "
                >
                    <i class="fas fa-users-cog"
                       style="width:14px;text-align:center;"></i>
                    Gestione consulenti
                </a>
            ` : ""}

            <button
                id="credipass-auth-logout"
                type="button"
                style="
                    width:100%;
                    display:flex;
                    align-items:center;
                    gap:9px;
                    padding:11px 14px;
                    border:0;
                    background:#fff;
                    color:#b42318;
                    font-family:inherit;
                    font-size:9px;
                    font-weight:800;
                    cursor:pointer;
                    text-align:left;
                "
            >
                <i class="fas fa-sign-out-alt"
                   style="width:14px;text-align:center;"></i>
                Disconnetti
            </button>
        </div>
    `;

    /*
     * POSIZIONAMENTO:
     *
     * 1) Gestione Consulenti:
     *    dentro .head, allineato a destra, senza uscire dal contenitore.
     *
     * 2) Scheda Consulenza:
     *    sopra i loghi, dentro .logo-area-stack.
     *
     * 3) Altre pagine:
     *    dentro .header-actions / .header.
     */
    const managementHead =
        document.querySelector(".head");

    const logoArea =
        document.querySelector(".logo-area-stack");

    const headerActions =
        document.querySelector(".header-actions");

    const header =
        document.querySelector(".header");

    if (
        managementHead &&
        document.querySelector(".container, .box")
    ) {
        managementHead.style.position = "relative";
        managementHead.style.display = "flex";
        managementHead.style.alignItems = "center";
        managementHead.style.justifyContent = "space-between";
        managementHead.style.gap = "14px";
        managementHead.style.flexWrap = "nowrap";

        wrapper.style.marginLeft = "auto";
        wrapper.style.width = "250px";
        wrapper.style.maxWidth = "250px";

        managementHead.appendChild(wrapper);

    } else if (logoArea) {
        logoArea.style.display = "flex";
        logoArea.style.flexDirection = "column";
        logoArea.style.alignItems = "center";
        logoArea.style.justifyContent = "flex-start";
        logoArea.style.gap = "8px";
        logoArea.style.position = "relative";
        logoArea.style.overflow = "visible";

        logoArea.prepend(wrapper);

    } else if (headerActions) {
        headerActions.style.display = "flex";
        headerActions.style.alignItems = "center";
        headerActions.style.gap = "10px";
        headerActions.style.flexWrap = "wrap";

        headerActions.prepend(wrapper);

    } else if (header) {
        header.style.position = "relative";
        header.style.display = "flex";
        header.style.alignItems = "center";
        wrapper.style.marginLeft = "auto";
        header.appendChild(wrapper);

    } else {
        wrapper.style.position = "fixed";
        wrapper.style.top = "12px";
        wrapper.style.right = "20px";
        wrapper.style.background = "#002d72";
        document.body.appendChild(wrapper);
    }

    const menuButton =
        document.getElementById(
            "credipass-user-menu-button"
        );

    const menu =
        document.getElementById(
            "credipass-user-menu"
        );

    const chevron =
        document.getElementById(
            "credipass-user-menu-chevron"
        );

    function setMenu(open) {
        if (!menu || !menuButton) return;

        menu.style.display =
            open ? "block" : "none";

        menuButton.setAttribute(
            "aria-expanded",
            open ? "true" : "false"
        );

        if (chevron) {
            chevron.style.transform =
                open
                    ? "rotate(180deg)"
                    : "rotate(0deg)";
        }
    }

    menuButton?.addEventListener(
        "click",
        event => {
            event.stopPropagation();

            const isOpen =
                menu &&
                menu.style.display === "block";

            setMenu(!isOpen);
        }
    );

    document.addEventListener(
        "click",
        event => {
            if (
                wrapper &&
                !wrapper.contains(event.target)
            ) {
                setMenu(false);
            }
        }
    );

    document.addEventListener(
        "keydown",
        event => {
            if (event.key === "Escape") {
                setMenu(false);
            }
        }
    );

    document.getElementById(
        "credipass-auth-logout"
    )
    ?.addEventListener(
        "click",
        async () => {
            try {
                await firebase.auth().signOut();
            } finally {
                window.location.replace(LOGIN);
            }
        }
    );

    // Dopo aver creato il menu, sistemiamo eventuali badge ruolo presenti nella pagina.
    styleRoleBadges();
}


function styleRoleBadges() {
    const badges =
        document.querySelectorAll(".badge");

    badges.forEach(badge => {
        const role =
            String(badge.textContent || "")
                .trim()
                .toLowerCase();

        badge.style.display = "inline-flex";
        badge.style.alignItems = "center";
        badge.style.justifyContent = "center";
        badge.style.minWidth = "92px";
        badge.style.height = "34px";
        badge.style.padding = "0 14px";
        badge.style.borderRadius = "999px";
        badge.style.fontSize = "9px";
        badge.style.fontWeight = "800";
        badge.style.lineHeight = "1";
        badge.style.textAlign = "center";
        badge.style.whiteSpace = "nowrap";
        badge.style.boxSizing = "border-box";
        badge.style.letterSpacing = ".1px";

        if (role.includes("admin")) {
            badge.style.background = "#eaf1ff";
            badge.style.color = "#002d72";
            badge.style.border = "1px solid #c9d8f3";
        } else if (role.includes("segreteria")) {
            badge.style.background = "#f0e9fb";
            badge.style.color = "#6d42b5";
            badge.style.border = "1px solid #dccdf2";
        } else {
            badge.style.background = "#e8f6ee";
            badge.style.color = "#087a4b";
            badge.style.border = "1px solid #c8e8d7";
        }
    });
}

function observeRoleBadges() {
    styleRoleBadges();

    const observer =
        new MutationObserver(() => {
            styleRoleBadges();
        });

    observer.observe(
        document.body,
        {
            childList: true,
            subtree: true
        }
    );
}

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        observeRoleBadges
    );
} else {
    observeRoleBadges();
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
