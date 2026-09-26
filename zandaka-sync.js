/* 残高くん: 認証済み本人のデータを専用Supabaseに保存 */
(function () {
  "use strict";
  var url = "https://usxwgvppdxgzfnepbpry.supabase.co";
  var key = "sb_publishable_lkP8UiZMxFNQOnQNE4qz6A_opG0_R7k";
  var style = document.createElement("style");
  style.textContent = ".zandaka-lock header,.zandaka-lock .viewbar,.zandaka-lock .switch,.zandaka-lock main,.zandaka-lock #chartView,.zandaka-lock .tools{visibility:hidden}#zandakaAuth{position:fixed;inset:0;z-index:10000;background:#f3f7f6;display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto}#zandakaAuth[hidden]{display:none}#zandakaAuth .auth-card{background:white;border-radius:18px;padding:24px;max-width:420px;width:100%;box-shadow:0 14px 40px #0002;color:#14202a;font:15px system-ui,sans-serif}#zandakaAuth h2{margin:0 0 10px;font-size:22px}#zandakaAuth p{line-height:1.6;color:#52646e}#zandakaAuth input{display:block;width:100%;box-sizing:border-box;padding:12px;margin:10px 0;border:1px solid #b8c7c9;border-radius:8px;font-size:16px}#zandakaAuth button{border:0;border-radius:8px;padding:12px;margin:6px 6px 0 0;background:#0e7c66;color:white;font-weight:700;font-size:15px;cursor:pointer}#zandakaAuth button.alt{background:#e8f1ef;color:#0e6f5a}#zandakaAuth .message{min-height:24px;color:#9b3f26}#zandakaSync{position:fixed;bottom:8px;right:8px;z-index:9000;background:#fff;border:1px solid #cbdad7;border-radius:20px;padding:5px 10px;font:12px system-ui,sans-serif;color:#234}#zandakaSync[hidden]{display:none}#zandakaSync button{border:0;background:none;color:#0e7c66;cursor:pointer;font:inherit}";
  document.head.appendChild(style);
  var gate = document.createElement("div");
  gate.id = "zandakaAuth";
  gate.innerHTML = '<div class="auth-card"><h2>残高くん</h2><p id="zaIntro">専用サーバーに保存するため、メールアドレスでログインしてください。初回はアカウント作成後、メールの確認リンクを開き、この画面に戻ってログインします。</p><div id="zaLogin"><input id="zaEmail" type="email" autocomplete="email" placeholder="メールアドレス"><input id="zaPassword" type="password" autocomplete="current-password" placeholder="パスワード（8文字以上）"><button id="zaSignIn">ログイン</button><button id="zaSignUp" class="alt">初回登録</button></div><div id="zaClaim" hidden><p>預けたデータを取り込むため、引継ぎコードを入力してください。一度取り込むと、次回からは自動で読み込みます。</p><input id="zaCode" type="text" autocomplete="off" placeholder="引継ぎコード"><button id="zaClaimButton">7か月分を取り込む</button><button id="zaClaimLogout" class="alt">別アカウントでログイン</button></div><p class="message" id="zaMessage" role="status"></p></div>';
  document.body.appendChild(gate);
  var badge = document.createElement("div");
  badge.id = "zandakaSync"; badge.hidden = true;
  badge.innerHTML = '<span id="zaSyncText">サーバー保存済</span> <button id="zaLogout">ログアウト</button>';
  document.body.appendChild(badge);
  var el = function (id) { return document.getElementById(id); };
  var msg = function (s) { el("zaMessage").textContent = s || ""; };
  var status = function (s) { el("zaSyncText").textContent = s; };
  if (!window.supabase) { msg("サーバー接続の読み込みに失敗しました。通信を確認して再読み込みしてください。"); return; }
  var client = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  var localSave = window.save, activeUser = null, loadingUser = null, dirty = false, flushing = false, timer = null;
  var pendingKey = "zandaka_pending_v1";
  function cleanState() {
    return JSON.parse(JSON.stringify(window.state, function (k, v) {
      return k && k.charAt(0) === "_" ? undefined : v;
    }));
  }
  function queueSave() {
    if (!activeUser) return;
    dirty = true; status("保存中…");
    try { localStorage.setItem(pendingKey, JSON.stringify({ userId: activeUser, payload: cleanState(), at: Date.now() })); } catch (e) {}
    clearTimeout(timer); timer = setTimeout(flush, 750);
  }
  async function flush() {
    if (flushing || !activeUser || !dirty) return;
    flushing = true;
    do {
      dirty = false;
      var userId = activeUser, snapshot = cleanState();
      var result = await client.from("zandaka_state").upsert({ user_id: userId, payload: snapshot, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (result.error) {
        dirty = true; status("保存失敗・端末内に保持中");
        break;
      }
    } while (dirty && activeUser);
    if (!dirty) { localStorage.removeItem(pendingKey); status("サーバー保存済"); }
    flushing = false;
  }
  window.save = function () { localSave(); queueSave(); };
  async function loadRemote(user) {
    if (loadingUser === user.id) return;
    loadingUser = user.id;
    activeUser = null; dirty = false; clearTimeout(timer);
    document.body.classList.add("zandaka-lock"); gate.hidden = false; badge.hidden = true;
    msg("サーバーのデータを確認中…");
    var result = await client.from("zandaka_state").select("payload,updated_at").eq("user_id", user.id).maybeSingle();
    if (result.error) { loadingUser = null; msg("読み込み失敗: " + result.error.message); return; }
    if (!result.data) {
      el("zaLogin").hidden = true; el("zaClaim").hidden = false;
      loadingUser = null;
      msg("初回の引継ぎコードを入力してください。");
      return;
    }
    var pending = null;
    try { pending = JSON.parse(localStorage.getItem(pendingKey)); } catch (e) {}
    var recover = pending && pending.userId === user.id && pending.at > Date.parse(result.data.updated_at);
    var payload = recover ? pending.payload : result.data.payload;
    if (!payload || !Array.isArray(payload.months) || !payload.months.length) {
      loadingUser = null; msg("保存データの形式を確認できませんでした。"); return;
    }
    window.state = payload;
    if (!window.state.current) window.state.current = window.state.months[0].id;
    window.migrate(window.state); localSave(); window.render();
    activeUser = user.id; loadingUser = null;
    if (recover) { dirty = true; flush(); }
    else localStorage.removeItem(pendingKey);
    gate.hidden = true; badge.hidden = false;
    document.body.classList.remove("zandaka-lock");
    status("サーバー保存済"); msg("");
  }
  async function authAction(kind) {
    var email = el("zaEmail").value.trim(), password = el("zaPassword").value;
    if (!email || password.length < 8) { msg("メールアドレスと8文字以上のパスワードを入力してください。"); return; }
    msg("確認中…");
    var result = kind === "signup"
      ? await client.auth.signUp({ email: email, password: password, options: { emailRedirectTo: location.origin + location.pathname } })
      : await client.auth.signInWithPassword({ email: email, password: password });
    if (result.error) { msg(result.error.message); return; }
    if (result.data.session) await loadRemote(result.data.session.user);
    else msg("確認メールを開いて登録を完了し、この画面からログインしてください。");
  }
  el("zaSignUp").onclick = function () { authAction("signup"); };
  el("zaSignIn").onclick = function () { authAction("signin"); };
  el("zaClaimButton").onclick = async function () {
    var code = el("zaCode").value.trim();
    if (!code) { msg("引継ぎコードを入力してください。"); return; }
    msg("取り込み中…");
    var result = await client.rpc("claim_zandaka_seed", { p_code: code });
    if (result.error || !result.data) { msg("取り込めませんでした。コードとログイン状態を確認してください。"); return; }
    el("zaCode").value = "";
    var session = await client.auth.getUser();
    if (session.data.user) await loadRemote(session.data.user);
  };
  async function signOut() {
    clearTimeout(timer);
    if (dirty) { await flush(); if (dirty) { msg("サーバー保存に失敗したため、ログアウトを中止しました。"); return; } }
    activeUser = null; dirty = false; clearTimeout(timer);
    localStorage.removeItem(window.KEY);
    el("main").replaceChildren(); el("switch").replaceChildren(); el("hBalance").textContent = "";
    await client.auth.signOut();
    document.body.classList.add("zandaka-lock");
    gate.hidden = false; badge.hidden = true;
    el("zaClaim").hidden = true; el("zaLogin").hidden = false;
    msg("ログアウトしました。");
  }
  el("zaLogout").onclick = signOut;
  el("zaClaimLogout").onclick = signOut;
  window.addEventListener("online", function () { if (dirty) flush(); });
  client.auth.onAuthStateChange(function (event, session) {
    if (event === "SIGNED_IN" && session && session.user && !activeUser)
      setTimeout(function () { loadRemote(session.user); }, 0);
    if (event === "SIGNED_OUT") {
      activeUser = null; gate.hidden = false; badge.hidden = true;
      document.body.classList.add("zandaka-lock");
    }
  });
  client.auth.getSession().then(function (r) {
    if (r.data.session) loadRemote(r.data.session.user);
    else { el("zaLogin").hidden = false; msg(""); }
  }).catch(function () { msg("認証状態を確認できません。通信を確認してください。"); });
})();