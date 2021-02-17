const fs = require('fs');
const path = require('path');
const hashsum = require('hash-sum');
const compiler = require('vue-template-compiler');
const { parse, compileTemplate, compileStyleAsync } = require('@vue/component-compiler-utils');

module.exports = function plugin(snowpackConfig) {
  return {
    name: '@snowpack/plugin-vue2',
    resolve: {
      input: ['.vue'],
      output: ['.js', '.css'],
    },
    async load({filePath}) {
      const {sourcemap, sourceMaps} = snowpackConfig.buildOptions;

      const id = hashsum(filePath);
      const contents = fs.readFileSync(filePath, 'utf-8');
      // const {descriptor, errors} = parse(contents, {filename: filePath});
      const descriptor = parse({
        source: contents,
        filename: filePath,
        compiler,
        needMap: true,
      });

      const output = {
        '.js': {code: '', map: ''},
        '.css': {code: '', map: ''},
      };

      if (descriptor.script) {
        const scriptLang = descriptor.script.lang;
        let scriptContent = descriptor.script.content;
        // if (['jsx', 'ts', 'tsx'].includes(scriptLang)) {
        //   scriptContent = scriptCompilers.esbuildCompile(scriptContent, scriptLang);
        // }
        if (['js', 'ts'].includes(scriptLang) || !scriptLang) {
          scriptContent = scriptContent.replace(`export default`, 'const defaultExport =');
        }
        output['.js'].code += scriptContent;
      } else {
        output['.js'].code += `const defaultExport = {};`;
      }

      let hasScoped = false;
      await Promise.all(
        descriptor.styles.map(async (stylePart) => {
          if (stylePart.scoped != null) {
            hasScoped = true;
          }
          const css = await compileStyleAsync({
            filename: path.relative(snowpackConfig.root || process.cwd(), filePath),
            source: stylePart.content,
            id: `data-v-${id}`,
            scoped: hasScoped,
            modules: stylePart.module != null,
            preprocessLang: stylePart.lang,
            // preprocessCustomRequire: (id: string) => require(resolve(root, id))
            // TODO load postcss config if present
          });
          if (css.errors && css.errors.length > 0) {
            console.error(JSON.stringify(css.errors));
          }
          output['.css'].code += css.code;
          if ((sourcemap || sourceMaps) && css.map) output['.css'].map += JSON.stringify(css.map);
        }),
      );
      if (hasScoped) {
        output['.js'].code += `defaultExport._scopeId = "data-v-${id}";`;
      }

      if (descriptor.template) {
        const js = compileTemplate({
          id,
          filename: path.relative(snowpackConfig.root || process.cwd(), filePath),
          source: descriptor.template.content,
          preprocessLang: descriptor.template.lang,
          compiler,
          compilerOptions: {
            scopeId: hasScoped ? `data-v-${id}` : null,
          },
          transformAssetUrls: false,
        });
        if (js.errors && js.errors.length > 0) {
          console.error(JSON.stringify(js.errors));
        }
        output['.js'].code += `\n${js.code}\n`;
        output['.js'].code += `\ndefaultExport.render = render`;
        output['.js'].code += `\ndefaultExport.staticRenderFns = staticRenderFns`;
        output['.js'].code += `\nexport default defaultExport`;

        if ((sourcemap || sourceMaps) && js.map) output['.js'].map += JSON.stringify(js.map);
      }

      // clean up
      if (!output['.js'].code) delete output['.js'];
      if (!output['.css'].code) delete output['.css'];

      return output;
    },
  };
};
