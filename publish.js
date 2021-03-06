
'use strict';

var doop = require('jsdoc/util/doop');
var fs = require('jsdoc/fs');
var helper = require('jsdoc/util/templateHelper');
var logger = require('jsdoc/util/logger');
var path = require('jsdoc/path');
var taffy = require('taffydb').taffy;
var template = require('jsdoc/template');
var util = require('util');

var htmlsafe = helper.htmlsafe;
var linkto = helper.linkto;
var resolveAuthorLinks = helper.resolveAuthorLinks;
var scopeToPunc = helper.scopeToPunc;
var hasOwnProp = Object.prototype.hasOwnProperty;

var data;
var view;

var outdir = path.normalize(env.opts.destination);

function find(spec) {
    return helper.find(data, spec);
}

function tutoriallink(tutorial) {
    return helper.toTutorial(tutorial, null, { tag: 'em', classname: 'disabled', prefix: 'Tutorial: ' });
}

function getAncestorLinks(doclet) {
    return helper.getAncestorLinks(data, doclet);
}

function hashToLink(doclet, hash) {
    if (!/^(#.+)/.test(hash)) {
        return hash;
    }

    var url = helper.createLink(doclet);

    url = url.replace(/(#.+|$)/, hash);
    return '<a href="' + url + '">' + hash + '</a>';
}

function needsSignature(doclet) {
    var needsSig = false;

    if (doclet.kind === 'function' || doclet.kind === 'class') {
        needsSig = true;
    } else if (doclet.kind === 'typedef' && doclet.type && doclet.type.names && doclet.type.names.length) {
            for (var i = 0, l = doclet.type.names.length; i < l; i++) {
                if (doclet.type.names[i].toLowerCase() === 'function') {
                    needsSig = true;
                    break;
                }
            }
        }

    return needsSig;
}

function getSignatureAttributes(item) {
    var attributes = [];

    if (item.optional) {
        attributes.push('opt');
    }

    if (item.nullable === true) {
        attributes.push('nullable');
    } else if (item.nullable === false) {
        attributes.push('non-null');
    }

    return attributes;
}

function updateItemName(item) {
    var attributes = getSignatureAttributes(item);
    var itemName = item.name || '';

    if (item.variable) {
        itemName = '&hellip;' + itemName;
    }

    if (attributes && attributes.length) {
        itemName = util.format('%s<span class="signature-attributes">%s</span>', itemName, attributes.join(', '));
    }

    return itemName;
}

function addParamAttributes(params) {
    return params.filter(function (param) {
        return param.name && param.name.indexOf('.') === -1;
    }).map(updateItemName);
}

function buildItemTypeStrings(item) {
    var types = [];

    if (item && item.type && item.type.names) {
        item.type.names.forEach(function (name) {
            types.push(linkto(name, htmlsafe(name)));
        });
    }

    return types;
}

function buildAttribsString(attribs) {
    var attribsString = '';

    if (attribs && attribs.length) {
        attribsString = htmlsafe(util.format('(%s) ', attribs.join(', ')));
    }

    return attribsString;
}

function addNonParamAttributes(items) {
    var types = [];

    items.forEach(function (item) {
        types = types.concat(buildItemTypeStrings(item));
    });

    return types;
}

function addSignatureParams(f) {
    var params = f.params ? addParamAttributes(f.params) : [];
    f.signature = util.format('%s(%s)', f.signature || '', params.join(', '));
}

function addSignatureReturns(f) {
    var attribs = [];
    var attribsString = '';
    var returnTypes = [];
    var returnTypesString = '';

    if (f.returns) {
        f.returns.forEach(function (item) {
            helper.getAttribs(item).forEach(function (attrib) {
                if (attribs.indexOf(attrib) === -1) {
                    attribs.push(attrib);
                }
            });
        });

        attribsString = buildAttribsString(attribs);
    }

    if (f.returns) {
        returnTypes = addNonParamAttributes(f.returns);
    }
    if (returnTypes.length) {
        returnTypesString = util.format(' &rarr; %s{%s}', attribsString, returnTypes.join('|'));
    }

    f.signature = '<span class="signature">' + (f.signature || '') + '</span>' + '<span class="type-signature">' + returnTypesString + '</span>';
}

function addSignatureTypes(f) {
    var types = f.type ? buildItemTypeStrings(f) : [];

    f.signature = (f.signature || '') + '<span class="type-signature">' + (types.length ? ' :' + types.join('|') : '') + '</span>';
}

function addAttribs(f) {
    var attribs = helper.getAttribs(f);
    var attribsString = buildAttribsString(attribs);

    f.attribs = util.format('<span class="type-signature">%s</span>', attribsString);
}

function shortenPaths(files, commonPrefix) {
    Object.keys(files).forEach(function (file) {
        files[file].shortened = files[file].resolved.replace(commonPrefix, '').replace(/\\/g, '/');
    });

    return files;
}

function getPathFromDoclet(doclet) {
    if (!doclet.meta) {
        return null;
    }

    return doclet.meta.path && doclet.meta.path !== 'null' ? path.join(doclet.meta.path, doclet.meta.filename) : doclet.meta.filename;
}

function generate(type, title, docs, filename, resolveLinks) {
    resolveLinks = resolveLinks === false ? false : true;

    var docData = {
        type: type,
        title: title,
        docs: docs
    };

    var outpath = path.join(outdir, filename),
        html = view.render('container.tmpl', docData);

    if (resolveLinks) {
        html = helper.resolveLinks(html);
    }

    fs.writeFileSync(outpath, html, 'utf8');
}

function generateSourceFiles(sourceFiles, encoding) {
    encoding = encoding || 'utf8';
    Object.keys(sourceFiles).forEach(function (file) {
        var source;

        var sourceOutfile = helper.getUniqueFilename(sourceFiles[file].shortened);
        helper.registerLink(sourceFiles[file].shortened, sourceOutfile);

        try {
            source = {
                kind: 'source',
                code: helper.htmlsafe(fs.readFileSync(sourceFiles[file].resolved, encoding))
            };
        } catch (e) {
            logger.error('Error while generating source file %s: %s', file, e.message);
        }

        generate('Source', sourceFiles[file].shortened, [source], sourceOutfile, false);
    });
}

function attachModuleSymbols(doclets, modules) {
    var symbols = {};

    doclets.forEach(function (symbol) {
        symbols[symbol.longname] = symbols[symbol.longname] || [];
        symbols[symbol.longname].push(symbol);
    });

    return modules.map(function (module) {
        if (symbols[module.longname]) {
            module.modules = symbols[module.longname].filter(function (symbol) {
                return symbol.description || symbol.kind === 'class';
            }).map(function (symbol) {
                symbol = doop(symbol);

                if (symbol.kind === 'class' || symbol.kind === 'function') {
                    symbol.name = symbol.name.replace('module:', '(require("') + '"))';
                }

                return symbol;
            });
        }
    });
}

function buildMemberNav(items, itemHeading, itemsSeen, linktoFn) {
    var nav = '';

    if (items && items.length) {
        var itemsNav = '';

        items.forEach(function (item) {
            var methods = find({ kind: 'function', memberof: item.longname });
            var members = find({ kind: 'member', memberof: item.longname });
            var docdash = env && env.conf && env.conf.docdash || {};

            if (!hasOwnProp.call(item, 'longname')) {
                itemsNav += '<li>' + linktoFn('', item.name);
                itemsNav += '</li>';
            } else if (!hasOwnProp.call(itemsSeen, item.longname)) {
                itemsNav += '<li>' + linktoFn(item.longname, item.name.replace(/^module:/, ''));

                if (docdash.static && members.find(function (m) {
                    return m.scope === 'static';
                })) {
                    itemsNav += "<ul class='members'>";

                    members.forEach(function (member) {
                        if (!member.scope === 'static') return;
                        itemsNav += "<li data-type='member'>";
                        itemsNav += linkto(member.longname, member.name);
                        itemsNav += "</li>";
                    });

                    itemsNav += "</ul>";
                }

                if (methods.length) {
                    itemsNav += "<ul class='methods'>";

                    methods.forEach(function (method) {
                        itemsNav += "<li data-type='method'>";
                        itemsNav += linkto(method.longname, method.name);
                        itemsNav += "</li>";
                    });

                    itemsNav += "</ul>";
                }

                itemsNav += '</li>';
                itemsSeen[item.longname] = true;
            }
        });

        if (itemsNav !== '') {
            nav += '<h3>' + itemHeading + '</h3><ul>' + itemsNav + '</ul>';
        }
    }

    return nav;
}

function linktoTutorial(longName, name) {
    return tutoriallink(name);
}

function linktoExternal(longName, name) {
    return linkto(longName, name.replace(/(^"|"$)/g, ''));
}

function buildNav(members) {
    var nav = '<h2><a href="index.html">Home</a></h2>';
    var seen = {};
    var seenTutorials = {};

    nav += buildMemberNav(members.classes, 'Classes', seen, linkto);
    nav += buildMemberNav(members.modules, 'Modules', {}, linkto);
    nav += buildMemberNav(members.externals, 'Externals', seen, linktoExternal);
    nav += buildMemberNav(members.events, 'Events', seen, linkto);
    nav += buildMemberNav(members.namespaces, 'Namespaces', seen, linkto);
    nav += buildMemberNav(members.mixins, 'Mixins', seen, linkto);
    nav += buildMemberNav(members.tutorials, 'Tutorials', seenTutorials, linktoTutorial);
    nav += buildMemberNav(members.interfaces, 'Interfaces', seen, linkto);

    if (members.globals.length) {
        var globalNav = '';

        members.globals.forEach(function (g) {
            if (g.kind !== 'typedef' && !hasOwnProp.call(seen, g.longname)) {
                globalNav += '<li>' + linkto(g.longname, g.name) + '</li>';
            }
            seen[g.longname] = true;
        });

        if (!globalNav) {
            nav += '<h3>' + linkto('global', 'Global') + '</h3>';
        } else {
            nav += '<h3>Global</h3><ul>' + globalNav + '</ul>';
        }
    }

    return nav;
}

var genLog = function genLog(fileName) {
    var fs = require('fs');
    var logger = fs.createWriteStream(fileName);
    return function (msg) {
        logger.write(msg);
    };
};
var log = genLog('../template/log.txt');

exports.publish = function (taffyData, opts, tutorials) {
    var docdash = env && env.conf && env.conf.docdash || {};
    data = taffyData;
    console.log('---------------');
    data().each(function (item) {
        log(JSON.stringify(item));
        log(',');
    });

    var conf = env.conf.templates || {};
    conf.default = conf.default || {};

    var templatePath = path.normalize(opts.template);
    view = new template.Template(path.join(templatePath, 'tmpl'));

    var indexUrl = helper.getUniqueFilename('index');


    var globalUrl = helper.getUniqueFilename('global');
    helper.registerLink('global', globalUrl);

    view.layout = conf.default.layoutFile ? path.getResourcePath(path.dirname(conf.default.layoutFile), path.basename(conf.default.layoutFile)) : 'layout.tmpl';

    helper.setTutorials(tutorials);

    data = helper.prune(data);

    docdash.sort !== false && data.sort('longname, version, since');
    helper.addEventListeners(data);

    var sourceFiles = {};
    var sourceFilePaths = [];
    data().each(function (doclet) {
        doclet.attribs = '';

        if (doclet.examples) {
            doclet.examples = doclet.examples.map(function (example) {
                var caption, code;

                if (example.match(/^\s*<caption>([\s\S]+?)<\/caption>(\s*[\n\r])([\s\S]+)$/i)) {
                    caption = RegExp.$1;
                    code = RegExp.$3;
                }

                return {
                    caption: caption || '',
                    code: code || example
                };
            });
        }
        if (doclet.see) {
            doclet.see.forEach(function (seeItem, i) {
                doclet.see[i] = hashToLink(doclet, seeItem);
            });
        }

        var sourcePath;
        if (doclet.meta) {
            sourcePath = getPathFromDoclet(doclet);
            sourceFiles[sourcePath] = {
                resolved: sourcePath,
                shortened: null
            };
            if (sourceFilePaths.indexOf(sourcePath) === -1) {
                sourceFilePaths.push(sourcePath);
            }
        }
    });

    var packageInfo = (find({ kind: 'package' }) || [])[0];
    if (packageInfo && packageInfo.name) {
        outdir = path.join(outdir, packageInfo.name, packageInfo.version || '');
    }
    fs.mkPath(outdir);

    var fromDir = path.join(templatePath, 'static');
    var staticFiles = fs.ls(fromDir, 3);

    staticFiles.forEach(function (fileName) {
        var toDir = fs.toDir(fileName.replace(fromDir, outdir));
        fs.mkPath(toDir);
        fs.copyFileSync(fileName, toDir);
    });

    var staticFilePaths;
    var staticFileFilter;
    var staticFileScanner;
    if (conf.default.staticFiles) {
        staticFilePaths = conf.default.staticFiles.include || conf.default.staticFiles.paths || [];
        staticFileFilter = new (require('jsdoc/src/filter').Filter)(conf.default.staticFiles);
        staticFileScanner = new (require('jsdoc/src/scanner').Scanner)();

        staticFilePaths.forEach(function (filePath) {
            var extraStaticFiles = staticFileScanner.scan([filePath], 10, staticFileFilter);

            extraStaticFiles.forEach(function (fileName) {
                var sourcePath = fs.toDir(filePath);
                var toDir = fs.toDir(fileName.replace(sourcePath, outdir));
                fs.mkPath(toDir);
                fs.copyFileSync(fileName, toDir);
            });
        });
    }

    if (sourceFilePaths.length) {
        sourceFiles = shortenPaths(sourceFiles, path.commonPrefix(sourceFilePaths));
    }
    data().each(function (doclet) {
        var url = helper.createLink(doclet);
        helper.registerLink(doclet.longname, url);

        var docletPath;
        if (doclet.meta) {
            docletPath = getPathFromDoclet(doclet);
            docletPath = sourceFiles[docletPath].shortened;
            if (docletPath) {
                doclet.meta.shortpath = docletPath;
            }
        }
    });

    data().each(function (doclet) {
        var url = helper.longnameToUrl[doclet.longname];

        if (url.indexOf('#') > -1) {
            doclet.id = helper.longnameToUrl[doclet.longname].split(/#/).pop();
        } else {
            doclet.id = doclet.name;
        }

        if (needsSignature(doclet)) {
            addSignatureParams(doclet);
            addSignatureReturns(doclet);
            addAttribs(doclet);
        }
    });

    data().each(function (doclet) {
        doclet.ancestors = getAncestorLinks(doclet);

        if (doclet.kind === 'member') {
            addSignatureTypes(doclet);
            addAttribs(doclet);
        }

        if (doclet.kind === 'constant') {
            addSignatureTypes(doclet);
            addAttribs(doclet);
            doclet.kind = 'member';
        }
    });

    var members = helper.getMembers(data);
    members.tutorials = tutorials.children;

    var outputSourceFiles = conf.default && conf.default.outputSourceFiles !== false ? true : false;

    view.find = find;
    view.linkto = linkto;
    view.resolveAuthorLinks = resolveAuthorLinks;
    view.tutoriallink = tutoriallink;
    view.htmlsafe = htmlsafe;
    view.outputSourceFiles = outputSourceFiles;

    view.nav = buildNav(members);
    attachModuleSymbols(find({ longname: { left: 'module:' } }), members.modules);

    if (outputSourceFiles) {
        generateSourceFiles(sourceFiles, opts.encoding);
    }

    if (members.globals.length) {
        generate('', 'Global', [{ kind: 'globalobj' }], globalUrl);
    }

    var files = find({ kind: 'file' });
    var packages = find({ kind: 'package' });

    generate('', 'Home', packages.concat([{ kind: 'mainpage', readme: opts.readme, longname: opts.mainpagetitle ? opts.mainpagetitle : 'Main Page' }]).concat(files), indexUrl);

    var classes = taffy(members.classes);
    var modules = taffy(members.modules);
    var namespaces = taffy(members.namespaces);
    var mixins = taffy(members.mixins);
    var externals = taffy(members.externals);
    var interfaces = taffy(members.interfaces);

    Object.keys(helper.longnameToUrl).forEach(function (longname) {
        var myModules = helper.find(modules, { longname: longname });
        if (myModules.length) {
            generate('Module', myModules[0].name, myModules, helper.longnameToUrl[longname]);
        }

        var myClasses = helper.find(classes, { longname: longname });
        if (myClasses.length) {
            generate('Class', myClasses[0].name, myClasses, helper.longnameToUrl[longname]);
        }

        var myNamespaces = helper.find(namespaces, { longname: longname });
        if (myNamespaces.length) {
            generate('Namespace', myNamespaces[0].name, myNamespaces, helper.longnameToUrl[longname]);
        }

        var myMixins = helper.find(mixins, { longname: longname });
        if (myMixins.length) {
            generate('Mixin', myMixins[0].name, myMixins, helper.longnameToUrl[longname]);
        }

        var myExternals = helper.find(externals, { longname: longname });
        if (myExternals.length) {
            generate('External', myExternals[0].name, myExternals, helper.longnameToUrl[longname]);
        }

        var myInterfaces = helper.find(interfaces, { longname: longname });
        if (myInterfaces.length) {
            generate('Interface', myInterfaces[0].name, myInterfaces, helper.longnameToUrl[longname]);
        }
    });

    function generateTutorial(title, tutorial, filename) {
        var tutorialData = {
            title: title,
            header: tutorial.title,
            content: tutorial.parse(),
            children: tutorial.children
        };

        var tutorialPath = path.join(outdir, filename);
        var html = view.render('tutorial.tmpl', tutorialData);

        html = helper.resolveLinks(html);
        fs.writeFileSync(tutorialPath, html, 'utf8');
    }

    function saveChildren(node) {
        node.children.forEach(function (child) {
            generateTutorial('Tutorial: ' + child.title, child, helper.tutorialToUrl(child.name));
            saveChildren(child);
        });
    }

    saveChildren(tutorials);
};