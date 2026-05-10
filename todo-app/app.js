import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TODO_COLS = "id, title, is_done, created_at";

const AUTH_COPY = {
  signin: {
    title: "Sign in",
    submit: "Sign in",
    toggleText: "No account?",
    toggleLink: "Create one",
    autocomplete: "current-password",
  },
  signup: {
    title: "Create account",
    submit: "Sign up",
    toggleText: "Already have an account?",
    toggleLink: "Sign in",
    autocomplete: "new-password",
  },
};

// ----- DOM -----
const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const authForm = document.getElementById("authForm");
const authTitle = document.getElementById("authTitle");
const authSubmit = document.getElementById("authSubmit");
const authToggle = document.getElementById("authToggle");
const authToggleText = document.getElementById("authToggleText");
const authMsg = document.getElementById("authMsg");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const signOutBtn = document.getElementById("signOutBtn");
const addForm = document.getElementById("addForm");
const newTitle = document.getElementById("newTitle");
const todoList = document.getElementById("todoList");
const emptyMsg = document.getElementById("emptyMsg");
const appMsg = document.getElementById("appMsg");

// ----- State -----
let mode = "signin";
let todos = [];
let currentUserId = null;

// ----- Helpers -----
function setMsg(el, text, kind = "") {
  el.textContent = text;
  el.classList.toggle("error", kind === "error");
  el.classList.toggle("success", kind === "success");
}

function setView(authed) {
  authView.classList.toggle("hidden", authed);
  appView.classList.toggle("hidden", !authed);
  signOutBtn.classList.toggle("hidden", !authed);
}

function applyAuthCopy() {
  const c = AUTH_COPY[mode];
  authTitle.textContent = c.title;
  authSubmit.textContent = c.submit;
  authToggleText.textContent = c.toggleText;
  authToggle.textContent = c.toggleLink;
  passwordInput.autocomplete = c.autocomplete;
}

function renderTodos() {
  todoList.innerHTML = "";
  emptyMsg.classList.toggle("hidden", todos.length > 0);

  for (const t of todos) {
    const li = document.createElement("li");
    li.className = "todo-item";
    li.classList.toggle("done", t.is_done);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = t.is_done;
    checkbox.addEventListener("change", () => toggleTodo(t.id, checkbox.checked));

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = t.title;

    const del = document.createElement("button");
    del.className = "delete";
    del.setAttribute("aria-label", "Delete task");
    del.textContent = "×";
    del.addEventListener("click", () => deleteTodo(t.id));

    li.append(checkbox, title, del);
    todoList.append(li);
  }
}

async function optimistic(update, remote) {
  const prev = todos;
  todos = update(prev);
  renderTodos();
  const { error } = await remote();
  if (error) {
    todos = prev;
    renderTodos();
    setMsg(appMsg, error.message, "error");
  }
}

// ----- Auth -----
authToggle.addEventListener("click", () => {
  mode = mode === "signin" ? "signup" : "signin";
  applyAuthCopy();
  setMsg(authMsg, "");
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authSubmit.disabled = true;
  setMsg(authMsg, "");

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  const { error } =
    mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

  authSubmit.disabled = false;

  if (error) {
    setMsg(authMsg, error.message, "error");
    return;
  }

  if (mode === "signup") {
    setMsg(
      authMsg,
      "Check your email to confirm your account, then sign in.",
      "success"
    );
  }
});

signOutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

// ----- Todos CRUD -----
async function loadTodos() {
  const { data, error } = await supabase
    .from("todos")
    .select(TODO_COLS)
    .order("created_at", { ascending: false });

  if (error) {
    setMsg(appMsg, error.message, "error");
    return;
  }
  todos = data ?? [];
  renderTodos();
}

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUserId) return;

  const title = newTitle.value.trim();
  if (!title) return;

  setMsg(appMsg, "");

  const { data, error } = await supabase
    .from("todos")
    .insert({ title, user_id: currentUserId })
    .select(TODO_COLS)
    .single();

  if (error) {
    setMsg(appMsg, error.message, "error");
    return;
  }
  newTitle.value = "";
  todos = [data, ...todos];
  renderTodos();
});

async function toggleTodo(id, isDone) {
  await optimistic(
    (ts) => ts.map((t) => (t.id === id ? { ...t, is_done: isDone } : t)),
    () => supabase.from("todos").update({ is_done: isDone }).eq("id", id)
  );
}

async function deleteTodo(id) {
  await optimistic(
    (ts) => ts.filter((t) => t.id !== id),
    () => supabase.from("todos").delete().eq("id", id)
  );
}

// ----- Session bootstrap -----
// onAuthStateChange fires INITIAL_SESSION for the persisted session, so a
// separate getSession() call would double-load on first render. Just listen.
applyAuthCopy();
supabase.auth.onAuthStateChange((_event, session) => {
  const userId = session?.user?.id ?? null;
  if (userId === currentUserId) return;
  currentUserId = userId;

  if (userId) {
    setView(true);
    loadTodos();
  } else {
    todos = [];
    renderTodos();
    setView(false);
    mode = "signin";
    applyAuthCopy();
    setMsg(authMsg, "");
  }
});
