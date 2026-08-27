(function () {
"use strict";

const LOGIN = "/main/login-consulente.html";
let sessionCache = null;


/* ============================================================
   UTILITY
   ============================================================ */

function roleOf(profile) {
    return String(
        profile?.ruolo || "consulente"
    ).toLowerCase();
}

function goLogin() {
    const back = encodeURIComponent(
        window.location.pathname +
        window.location.search +
        window.location.hash
    );

    window.location.replace(
        `${LOGIN}?return=${back}`
    );
}

function isArchivePage() {
    return window.location.pathname
        .toLowerCase()
        .includes("ricerca-clienti");
}

function isConsultantsPage() {
    return window.location.pathname
        .toLowerCase()
        .includes("gestione-consulenti");
}

function isConsultationPage() {
    const path =
        window.location.pathname
            .toLowerCase();

    return (
        path === "/" ||
        path.endsWith("/index.html")
    );
}


/* ============================================================
   BADGE RUOLI - GESTIONE CONSULENTI
   ============================================================ */

function styleRoleBadges() {
    const badges =
        document.querySelectorAll(".badge");

    badges.forEach(badge => {
        const role =
            String(
                badge.textContent || ""
            )
            .trim()
            .toLowerCase();

        badge.style.display =
            "inline-flex";

        badge.style.alignItems =
            "center";

        badge.style.justifyContent =
            "center";

        badge.style.minWidth =
            "112px";

        badge.style.height =
            "42px";

        badge.style.padding =
            "0 16px";

        badge.style.borderRadius =
            "999px";

        badge.style.fontSize =
            "10px";

        badge.style.fontWeight =
            "800";

        badge.style.lineHeight =
            "1";

        badge.style.textAlign =
            "center";

        badge.style.whiteSpace =
            "nowrap";

        badge.style.boxSizing =
            "border-box";

        if (role.includes("admin")) {

            badge.style.background =
                "#eaf1ff";

            badge.style.color =
                "#002d72";

            badge.style.border =
                "1px solid #bfd1f1";

        } else if (
            role.includes("segreteria")
        ) {

            badge.style.background =
                "#f0e9fb";

            badge.style.color =
                "#6d42b5";

            badge.style.border =
                "1px solid #dccdf2";

        } else {

            badge.style.background =
                "#e8f6ee";

            badge.style.color =
                "#087a4b";

            badge.style.border =
                "1px solid #c8e8d7";
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


/* ============================================================
   LINK "TORNA ALLA SCHEDA"
   ============================================================ */

function findReturnLink(container) {
    const candidates =
        Array.from(
            (container || document)
                .querySelectorAll(
                    "a, button"
                )
        );

    return candidates.find(el => {
        const text =
            String(
                el.textContent || ""
            )
            .trim()
            .toLowerCase();

        return (
            text.includes(
                "torna alla scheda"
            ) ||
            text.includes(
                "scheda consulenza"
            )
        );
    }) || null;
}

function createReturnLink() {
    const link =
        document.createElement("a");

    link.href = "/";

    link.innerHTML =
        '<i class="fas fa-arrow-left"></i> TORNA ALLA SCHEDA';

    link.style.cssText = [
        "display:inline-flex",
        "align-items:center",
        "justify-content:center",
        "gap:7px",
        "height:38px",
        "padding:0 14px",
        "border-radius:7px",
        "background:#002d72",
        "color:#ffffff",
        "text-decoration:none",
        "font-family:Poppins,Arial,sans-serif",
        "font-size:9px",
        "font-weight:800",
        "white-space:nowrap",
        "flex-shrink:0",
        "border:1px solid rgba(255,255,255,.18)"
    ].join(";");

    return link;
}

function normalizeReturnLink(link) {
    if (!link) return;

    link.style.display =
        "inline-flex";

    link.style.alignItems =
        "center";

    link.style.justifyContent =
        "center";

    link.style.gap =
        "7px";

    link.style.height =
        "38px";

    link.style.padding =
        "0 14px";

    link.style.borderRadius =
        "7px";

    link.style.background =
        "#002d72";

    link.style.color =
        "#ffffff";

    link.style.textDecoration =
        "none";

    link.style.fontFamily =
        "Poppins,Arial,sans-serif";

    link.style.fontSize =
        "9px";

    link.style.fontWeight =
        "800";

    link.style.whiteSpace =
        "nowrap";

    link.style.flexShrink =
        "0";

    link.style.margin =
        "0";

    if (
        !String(
            link.innerHTML || ""
        ).includes("fa-arrow-left")
    ) {
        const text =
            String(
                link.textContent || ""
            ).trim();

        link.innerHTML =
            `<i class="fas fa-arrow-left"></i> ${text}`;
    }
}


/* ============================================================
   MENU UTENTE
   ============================================================ */

function injectBadge(session) {
    if (
        document.getElementById(
            "credipass-auth-badge"
        )
    ) {
        return;
    }

    const wrapper =
        document.createElement("div");

    wrapper.id =
        "credipass-auth-badge";

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
            session.profile?.ruolo ||
            "consulente"
        ).toUpperCase();

    const iniziale =
        String(
            displayName || "C"
        )
        .trim()
        .charAt(0)
        .toUpperCase();

    /*
     * Il box utente è SEMPRE BLU.
     * Così resta leggibile anche nelle pagine con header bianco,
     * come Archivio Pratiche.
     */
    wrapper.style.cssText = [
        "position:relative",
        "display:flex",
        "align-items:center",
        "width:250px",
        "max-width:250px",
        "min-width:220px",
        "padding:8px 10px",
        "border-radius:10px",
        "background:#002d72",
        "border:1px solid rgba(255,255,255,.22)",
        "border-left:4px solid #C99700",
        "box-shadow:0 5px 16px rgba(0,0,0,.16)",
        "font-family:Poppins,Arial,sans-serif",
        "z-index:1000",
        "flex-shrink:0",
        "box-sizing:border-box"
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
                gap:9px;
                cursor:pointer;
                font-family:inherit;
                text-align:left;
                min-width:0;
            "
        >
            <div
                style="
                    width:32px;
                    height:32px;
                    border-radius:50%;
                    background:#C99700;
                    color:#002d72;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    font-weight:800;
                    flex-shrink:0;
                    font-size:12px;
                "
            >
                ${iniziale}
            </div>

            <div
                style="
                    min-width:0;
                    flex:1;
                    line-height:1.15;
                "
            >
                <div
                    style="
                        font-size:10px;
                        font-weight:800;
                        color:#fff;
                        white-space:nowrap;
                        overflow:hidden;
                        text-overflow:ellipsis;
                    "
                >
                    ${displayName}
                </div>

                <div
                    style="
                        margin-top:2px;
                        font-size:8px;
                        font-weight:800;
                        color:#C99700;
                        letter-spacing:.4px;
                    "
                >
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
                top:calc(100% + 7px);
                right:0;
                width:250px;
                background:#002d72;
                border:1px solid rgba(255,255,255,.22);
                border-radius:10px;
                box-shadow:0 14px 32px rgba(0,0,0,.24);
                overflow:hidden;
                z-index:50000;
            "
        >
            <div
                style="
                    padding:12px 14px;
                    background:rgba(255,255,255,.06);
                    border-bottom:1px solid rgba(255,255,255,.13);
                "
            >
                <div
                    style="
                        color:#ffffff;
                        font-size:10px;
                        font-weight:800;
                        white-space:nowrap;
                        overflow:hidden;
                        text-overflow:ellipsis;
                    "
                >
                    ${displayName}
                </div>

                <div
                    style="
                        margin-top:3px;
                        color:rgba(255,255,255,.68);
                        font-size:8px;
                        white-space:nowrap;
                        overflow:hidden;
                        text-overflow:ellipsis;
                    "
                >
                    ${email}
                </div>
            </div>

            <a
                href="/main/ricerca-clienti.html"
                class="credipass-user-menu-item"
                style="
                    display:flex;
                    align-items:center;
                    gap:10px;
                    padding:12px 14px;
                    color:#ffffff;
                    text-decoration:none;
                    font-size:9px;
                    font-weight:700;
                    border-bottom:1px solid rgba(255,255,255,.13);
                    transition:background .15s ease,color .15s ease;
                "
            >
                <i
                    class="fas fa-folder-open"
                    style="
                        width:15px;
                        text-align:center;
                    "
                ></i>

                Archivio pratiche
            </a>

            ${session.isAdmin ? `
                <a
                    href="/main/gestione-consulenti.html"
                    class="credipass-user-menu-item"
                    style="
                        display:flex;
                        align-items:center;
                        gap:10px;
                        padding:12px 14px;
                        color:#ffffff;
                        text-decoration:none;
                        font-size:9px;
                        font-weight:700;
                        border-bottom:1px solid rgba(255,255,255,.13);
                        transition:background .15s ease,color .15s ease;
                    "
                >
                    <i
                        class="fas fa-users-cog"
                        style="
                            width:15px;
                            text-align:center;
                        "
                    ></i>

                    Gestione consulenti
                </a>
            ` : ""}

            <button
                id="credipass-auth-logout"
                type="button"
                class="credipass-user-menu-item"
                style="
                    width:100%;
                    display:flex;
                    align-items:center;
                    gap:10px;
                    padding:12px 14px;
                    border:0;
                    background:transparent;
                    color:#ffffff;
                    font-family:inherit;
                    font-size:9px;
                    font-weight:800;
                    cursor:pointer;
                    text-align:left;
                    transition:background .15s ease,color .15s ease;
                "
            >
                <i
                    class="fas fa-sign-out-alt"
                    style="
                        width:15px;
                        text-align:center;
                    "
                ></i>

                Disconnetti
            </button>
        </div>
    `;


    /* ========================================================
       POSIZIONAMENTO PER PAGINA
       ======================================================== */

    if (isArchivePage()) {

        const header =
            document.querySelector(
                ".search-container .header"
            ) ||
            document.querySelector(
                ".header"
            );

        if (header) {

            /*
             * Archivio:
             *
             * Archivio Pratiche                 [TORNA] [UTENTE]
             * Gestione e Ricerca Clienti
             *
             * Il pulsante TORNA è SEMPRE a sinistra del menu.
             */
            header.style.position =
                "relative";

            header.style.textAlign =
                "left";

            header.style.display =
                "grid";

            header.style.gridTemplateColumns =
                "minmax(0,1fr) auto";

            header.style.gridTemplateRows =
                "auto auto";

            header.style.columnGap =
                "18px";

            header.style.rowGap =
                "4px";

            header.style.alignItems =
                "center";

            const title =
                header.querySelector("h1");

            const subtitle =
                header.querySelector("p");

            if (title) {
                title.style.gridColumn =
                    "1";

                title.style.gridRow =
                    "1";
            }

            if (subtitle) {
                subtitle.style.gridColumn =
                    "1";

                subtitle.style.gridRow =
                    "2";

                subtitle.style.margin =
                    "0";
            }

            let rightControls =
                document.getElementById(
                    "credipass-archive-right-controls"
                );

            if (!rightControls) {
                rightControls =
                    document.createElement(
                        "div"
                    );

                rightControls.id =
                    "credipass-archive-right-controls";

                rightControls.style.cssText = [
                    "grid-column:2",
                    "grid-row:1 / span 2",
                    "display:flex",
                    "align-items:center",
                    "justify-content:flex-end",
                    "gap:12px",
                    "min-width:0",
                    "align-self:center"
                ].join(";");

                header.appendChild(
                    rightControls
                );
            }

            let returnLink =
                findReturnLink(
                    document
                );

            /*
             * Se il pulsante esiste già nella pagina lo SPOSTIAMO.
             * Non ne creiamo un duplicato.
             */
            if (
                returnLink &&
                !wrapper.contains(
                    returnLink
                )
            ) {
                normalizeReturnLink(
                    returnLink
                );

                rightControls.appendChild(
                    returnLink
                );

            } else if (!returnLink) {

                returnLink =
                    createReturnLink();

                rightControls.appendChild(
                    returnLink
                );
            }

            rightControls.appendChild(
                wrapper
            );
        }

    } else if (isConsultantsPage()) {

        const head =
            document.querySelector(
                ".head"
            );

        if (head) {

            /*
             * Gestione Consulenti:
             *
             * [Gestione Consulenti]      [TORNA] [UTENTE]
             */
            head.style.position =
                "relative";

            head.style.display =
                "flex";

            head.style.alignItems =
                "center";

            head.style.justifyContent =
                "space-between";

            head.style.gap =
                "18px";

            head.style.flexWrap =
                "nowrap";

            let rightControls =
                document.getElementById(
                    "credipass-management-right-controls"
                );

            if (!rightControls) {

                rightControls =
                    document.createElement(
                        "div"
                    );

                rightControls.id =
                    "credipass-management-right-controls";

                rightControls.style.cssText = [
                    "margin-left:auto",
                    "display:flex",
                    "align-items:center",
                    "justify-content:flex-end",
                    "gap:12px",
                    "min-width:0",
                    "flex:0 1 auto"
                ].join(";");

                head.appendChild(
                    rightControls
                );
            }

            let returnLink =
                findReturnLink(
                    head
                ) ||
                findReturnLink(
                    document
                );

            if (
                returnLink &&
                !wrapper.contains(
                    returnLink
                )
            ) {

                normalizeReturnLink(
                    returnLink
                );

                rightControls.appendChild(
                    returnLink
                );

            } else if (!returnLink) {

                returnLink =
                    createReturnLink();

                rightControls.appendChild(
                    returnLink
                );
            }

            rightControls.appendChild(
                wrapper
            );
        }

    } else if (isConsultationPage()) {

        /*
         * Scheda consulenza:
         * il box resta SOPRA al logo Credipass.
         */
        const logoArea =
            document.querySelector(
                ".logo-area-stack"
            );

        if (logoArea) {

            logoArea.style.display =
                "flex";

            logoArea.style.flexDirection =
                "column";

            logoArea.style.alignItems =
                "center";

            logoArea.style.justifyContent =
                "flex-start";

            logoArea.style.gap =
                "8px";

            logoArea.style.position =
                "relative";

            logoArea.style.overflow =
                "visible";

            logoArea.prepend(
                wrapper
            );

        } else {

            document.body.appendChild(
                wrapper
            );
        }

    } else {

        /*
         * Fallback per altre pagine.
         */
        const headerActions =
            document.querySelector(
                ".header-actions"
            );

        const header =
            document.querySelector(
                ".header"
            );

        if (headerActions) {

            headerActions.style.display =
                "flex";

            headerActions.style.alignItems =
                "center";

            headerActions.style.gap =
                "10px";

            headerActions.appendChild(
                wrapper
            );

        } else if (header) {

            header.style.position =
                "relative";

            header.style.display =
                "flex";

            header.style.alignItems =
                "center";

            wrapper.style.marginLeft =
                "auto";

            header.appendChild(
                wrapper
            );

        } else {

            wrapper.style.position =
                "fixed";

            wrapper.style.top =
                "12px";

            wrapper.style.right =
                "20px";

            document.body.appendChild(
                wrapper
            );
        }
    }


    /* ========================================================
       MENU APERTURA / CHIUSURA
       ======================================================== */

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
        if (
            !menu ||
            !menuButton
        ) {
            return;
        }

        menu.style.display =
            open
                ? "block"
                : "none";

        menuButton.setAttribute(
            "aria-expanded",
            open
                ? "true"
                : "false"
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
                menu.style.display ===
                    "block";

            setMenu(
                !isOpen
            );
        }
    );

    document.addEventListener(
        "click",
        event => {

            if (
                wrapper &&
                !wrapper.contains(
                    event.target
                )
            ) {
                setMenu(false);
            }
        }
    );

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Escape"
            ) {
                setMenu(false);
            }
        }
    );


    /* ========================================================
       HOVER MENU
       ======================================================== */

    wrapper
        .querySelectorAll(
            ".credipass-user-menu-item"
        )
        .forEach(item => {

            item.addEventListener(
                "mouseenter",
                () => {

                    item.style.background =
                        "#C99700";

                    item.style.color =
                        "#002d72";
                }
            );

            item.addEventListener(
                "mouseleave",
                () => {

                    item.style.background =
                        item.tagName ===
                        "BUTTON"
                            ? "transparent"
                            : "";

                    item.style.color =
                        "#ffffff";
                }
            );
        });


    /* ========================================================
       LOGOUT
       ======================================================== */

    document.getElementById(
        "credipass-auth-logout"
    )
    ?.addEventListener(
        "click",
        async () => {

            try {

                await firebase.auth()
                    .signOut();

            } finally {

                window.location.replace(
                    LOGIN
                );
            }
        }
    );

    styleRoleBadges();
}


/* ============================================================
   PROFILO CONSULENTE
   ============================================================ */

async function ensureProfile(user) {
    const fn =
        firebase.app()
            .functions(
                "us-central1"
            )
            .httpsCallable(
                "ensureConsultantProfile"
            );

    const result =
        await fn({});

    const profile =
        result?.data?.profile ||
        {};

    return {
        user,
        profile,
        isAdmin:
            roleOf(profile) ===
            "admin"
    };
}


/* ============================================================
   GUARD AUTENTICAZIONE
   ============================================================ */

async function guard(options = {}) {

    if (sessionCache) {

        if (
            options.adminOnly &&
            !sessionCache.isAdmin
        ) {

            window.location.replace(
                "/"
            );

            throw new Error(
                "Accesso riservato all'amministratore."
            );
        }

        return sessionCache;
    }

    await firebase.auth()
        .setPersistence(
            firebase.auth
                .Auth
                .Persistence
                .LOCAL
        );

    const user =
        await new Promise(
            (resolve, reject) => {

                const unsubscribe =
                    firebase.auth()
                        .onAuthStateChanged(
                            u => {

                                unsubscribe();

                                resolve(u);
                            },
                            reject
                        );
            }
        );

    if (!user) {

        goLogin();

        throw new Error(
            "Utente non autenticato."
        );
    }

    /*
     * Manteniamo la verifica email obbligatoria.
     * NON facciamo reinvii ripetuti ad ogni refresh:
     * evitiamo TOO_MANY_ATTEMPTS_TRY_LATER.
     */
    if (!user.emailVerified) {

        await firebase.auth()
            .signOut();

        window.location.replace(
            `${LOGIN}?verify=1&email=${
                encodeURIComponent(
                    user.email || ""
                )
            }`
        );

        throw new Error(
            "Email non verificata."
        );
    }

    sessionCache =
        await ensureProfile(
            user
        );

    if (
        sessionCache.profile
            .attivo === false
    ) {

        await firebase.auth()
            .signOut();

        goLogin();

        throw new Error(
            "Account disattivato."
        );
    }

    if (
        options.adminOnly &&
        !sessionCache.isAdmin
    ) {

        window.location.replace(
            "/"
        );

        throw new Error(
            "Accesso riservato all'amministratore."
        );
    }

    injectBadge(
        sessionCache
    );

    return sessionCache;
}


/* ============================================================
   ACCESSO PRATICHE
   ============================================================ */

async function practiceIsAccessible(
    data = {}
) {

    const session =
        sessionCache ||
        await guard();

    if (
        session.isAdmin
    ) {
        return true;
    }

    const owner =
        data.consulente_uid ||
        data.workspace_uid ||
        data.owner_uid ||
        "";

    return (
        owner ===
        session.user.uid
    );
}


/* ============================================================
   AVVIO STILI DINAMICI
   ============================================================ */

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        observeRoleBadges
    );

} else {

    observeRoleBadges();
}


/* ============================================================
   API PUBBLICA
   ============================================================ */

window.CredipassAuth = {
    guard,

    getSession:
        () =>
            sessionCache ||
            guard(),

    practiceIsAccessible
};

})();
