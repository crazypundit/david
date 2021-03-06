/**
 * david
 * https://github.com/alanshaw/david
 *
 * Copyright (c) 2013 Alan Shaw
 * Licensed under the MIT license.
 */

var npm = require("npm")
  , async = require("async")
  , semver = require("semver")
  , semverext = require("./semverext")

/**
 * Get dependency info - latest version and latest stable version 
 * @param {String} name Dependency name
 * @param {Object} opts Options
 * @param {Boolean} [opts.loose] Use loose option when querying semver
 * @param {Function} cb
 */
function getLatestVerInfo (name, opts, cb) {
  npm.load({}, function (er) {
    if (er) return cb(er)
    
    npm.commands.view([name, "versions", "time"], true, function (er, data) {
      if (er) return cb(er)
      
      var stable = Object.keys(data)[0]
        , versions = null

      // `npm view 0 versions` returns {}
      if (!stable) {
        return cb(new Error("Failed to get latest version info for " + name))
      }

      // Some packages simply don't have a time object
      if (data[stable].time) {
        versions = data[stable].versions.sort(function (a, b) {
          a = data[stable].time[a]
          b = data[stable].time[b]
          return (a < b ? -1 : (a > b ? 1 : 0))
        })
      } else {
        versions = data[stable].versions
      }

      var latest = versions[versions.length-1]

      if (!isStable(stable)) {
        stable = getLatestStable(versions)
      }
      
      // getLatestStable might not have found a stable version
      if (stable) {
        // Latest is the most recent version with higher version than stable
        for (var i = versions.length-1; i >= 0; i--) {
          if (semver.gt(versions[i], stable, opts.loose)) {
            latest = versions[i]
            break
          }
        }
      }

      cb(null, {name: name, latest: latest, stable: stable})
    })
  })
}

/**
 * Determine if a version is a stable version or not.
 * @param {String} version
 * @return {Boolean}
 */
function isStable (version) {
  return !(/[a-z+\-]/i.test(version || ""))
}

/**
 * Get the latest stable version from a list of versions in ascending order.
 * @param {Array} versions
 * @return {String}
 */
function getLatestStable (versions) {
  versions = versions.slice()
  while (versions.length) {
    var version = versions.pop()
    if (isStable(version)) {
      return version
    }
  }
  return null
}

// Convert dependencies specified as an array to an object
function normaliseDeps (deps) {
  if (Array.isArray(deps)) {
    deps = deps.reduce(function (d, depName) {
      d[depName] = "*"
      return d
    }, {})
  }
  return deps
}

/**
 * Given dep, an object obtained by calling getDependencies, determine whether dep.required (the version specified
 * in package.json) is out of date wrt dep.stable or dep.latest.
 * @param {Object} dep
 * @param {Object} [opts] Options
 * @param {Boolean} [opts.stable] Consider only stable packages
 * @param {Boolean} [opts.loose] Use loose option when querying semver
 * @returns {boolean}
 */
function isUpdated (dep, opts) {
  opts = opts || {}
  
  var required = dep.required || "*"
  
  // TODO: Handle tags correctly
  if (required != "latest" && required != "*") {
    
    var range = semver.validRange(required, opts.loose) || ""
      , version = opts.stable ? dep.stable : dep.latest
    
    if (version) {
      if (!range) {
        return true
      } else if (!semver.satisfies(version, range, opts.loose)) {
        if (opts.stable && semverext.gtr(version, range, opts.loose)) {
          return true
        } else if (!opts.stable) {
          return true
        }
      }
    }
  }
  return false
}

module.exports.isUpdated = isUpdated

/**
 * Get a list of dependencies for the passed manifest.
 * @param {Object} manifest Parsed package.json file contents
 * @param {Object|Function} [opts] Options or callback
 * @param {Boolean} [opts.dev] Consider devDependencies
 * @param {Boolean} [opts.optional] Consider optionalDependencies
 * @param {Boolean} [opts.peer] Consider peerDependencies
 * @param {Boolean} [opts.loose] Use loose option when querying semver
 * @param {Function} cb Function that receives the results
 */
function getDependencies (manifest, opts, cb) {
  // Allow callback to be passed as second parameter
  if (!cb) {
    cb = opts
    opts = {}
  } else {
    opts = opts || {}
  }
  
  function depType () {
    if (opts.dev) {
      return "devDependencies"
    } else if (opts.optional) {
      return "optionalDependencies"
    } else if (opts.peer) {
      return "peerDependencies"
    }
    return "dependencies"
  }
  
  var pkgs = {}
    , deps = normaliseDeps(manifest[depType()] || {})
    , depNames = Object.keys(deps)
  
  if (!depNames.length) {
    return setImmediate(function () { cb(null, pkgs) })
  }
  
  var tasks = depNames.map(function (depName) {
    return function (cb) {
      getLatestVerInfo(depName, opts, function (er, info) {
        if (er) {
          console.error("Failed to get dependency", depName, er)
        } else {
          pkgs[depName] = {required: deps[depName], stable: info.stable, latest: info.latest}
        }
        cb()
      })
    }
  })
  
  async.parallel(tasks, function () { cb(null, pkgs) })
}

module.exports.getDependencies = getDependencies

/**
 * Get a list of updated packages for the passed manifest.
 * @param {Object} manifest Parsed package.json file contents
 * @param {Object|Function} [opts] Options or callback
 * @param {Boolean} [opts.stable] Consider only stable packages
 * @param {Boolean} [opts.dev] Consider devDependencies
 * @param {Boolean} [opts.optional] Consider optionalDependencies
 * @param {Boolean} [opts.peer] Consider peerDependencies
 * @param {Boolean} [opts.loose] Use loose option when querying semver
 * @param {Function} cb Function that receives the results
 */
module.exports.getUpdatedDependencies = function (manifest, opts, cb) {
  if (!cb) {
    cb = opts
    opts = {}
  } else {
    opts = opts || {}
  }
  
  getDependencies(manifest, opts, function (er, pkgs) {
    if (er) return cb(er)
    
    // Filter out the non-updated dependencies
    Object.keys(pkgs).forEach(function (depName) {
      if (!isUpdated(pkgs[depName], opts)) {
        delete pkgs[depName]
      }
    })
    
    cb(null, pkgs)
  })
}
