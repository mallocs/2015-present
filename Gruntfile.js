'use strict';

module.exports = function (grunt) {

    // Load all grunt tasks
    require('load-grunt-tasks')(grunt);

    // Project configuration.
    grunt.initConfig({
        // Metadata.
        pkg: grunt.file.readJSON('package.json'),
        connect: {
            server: {
                options: {
                    hostname: 'localhost',
                    port: 9002,
                    keepalive: true,
                    debug: true
                }
            }
        }
    });

    grunt.registerTask('serve', ['connect']);

};
