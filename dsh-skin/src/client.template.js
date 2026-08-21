window.__ModuleLoader__.load({
	id: "@linxin666/dsh-client-ui-skin-claude-code-white",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const css = {{CSS_JSON}};
		const tagId = "@linxin666/dsh-client-ui-skin-claude-code-white/ccw.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-client-ui-skin-claude-code-white";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		/**
		* Apply the Claude Code White skin: body attribute (scopes the theme
		* CSS), tab title and favicon. All writes are retracted by the effect
		* disposer on dispose.
		*/
		function apply(ctx) {
			const body = document.body;
			const originalTitle = document.title;
			body.dataset.dshClaudeCodeWhite = "";
			document.title = "Claude Code White";
			const favicon = document.createElement("link");
			favicon.rel = "icon";
			favicon.href = {{FAVICON_JSON}};
			document.head.append(favicon);
			ctx.effect(() => () => {
				delete body.dataset.dshClaudeCodeWhite;
				if (document.title === "Claude Code White") document.title = originalTitle;
				favicon.remove();
			}, "ui-skin-claude-code-white: CCW theme");
		}
		exports.apply = apply;
		return module.exports;
	}
});
