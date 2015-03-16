/****
* mallocs media industries
* http://www.mallocs.net
****/

/****
* mallocs media industries
* http://www.mallocs.net
****/  

/************************************************************************************************
 * Cluster Manager
 ************************************************************************************************/

/**
 * @name ClusterManager
 * @version 2.0
 * @author Marcus Ulrich
 * @fileoverview
 * This library creates and manages clusters for Google Maps API v3. It does two things to make maps 
 * with large numbers of markers more useable: 1) Combines markers in close proximity to each other 
 * based on zoom level into clusters, 2) Only adds markers in the current viewport (and optional 
 * padding) to the map.
 * <b>How it works</b>:<br/>
 * The manager sets up a dictionary for clusters and a dictionary for markers. Every marker that's 
 * added to the manager has a string created based on it's latitude, longitude, and zoom level and 
 * that's used to add it to the cluster dictionary. Nearby markers will hash to the same string so 
 * nothing has to be calculated. Nearby clusters are then combined.
 * Markers can be added with optional type and subtypes so subsets of markers can be shown and 
 * hidden. Markers with the same subtype will still be clustered together, but can be shown or 
 * hidden seperately. Markers with the same type will be clustered together and can also be hidden
 * or shown seperately.
 * The function used to create the clusters is stored and this function can be overridden for 
 * greater control of the look and/or behavior of the clusters for each marker type.
 */
 
/***************************************************************************************************
 * Cluster Manager
 **************************************************************************************************/

/**
 * Creates a new Cluster Manager for clustering markers on a V3 Google map.
 *
 * @param {GMap3} map The map that the markers should be added to.
 * @param {object} [opts] Options for configuring the behavior of the clustering. Defaults are 
 * applied in resetManager.
 * @param {google.maps.Marker[]} [opts.markers] Markers to add to the manager.
 * @param {function} [opts.zoom_to_precision=function(zoom_level) {return zoom_level + precision;}] 
 * A function to set the precision for each zoom level. 
 * @param {number} [opts.precision=2] A number between 0 and 27 that sets how small the cluster 
 * boxes will be. Higher numbers will make smaller boxes.
 * @param {string|object} [opts.icon_color="00CC00"] Sets the default icon color in HEX. Default is 
 * a bright green.
 * @param {number} [opts.padding=200] The amount of padding in pixels where markers not in the 
 * viewport will still be added to the map.
 * @param {boolean} [opts.visualize=false] For debugging. Will put a box around each cluster with at 
 * least one marker.
 * @param {number} [opts.cluster_by_distance=true] Combine neighboring clusters if they are close 
 * together. This is a little slower but makes more rounded clusters.
 * @param {number} [opts.cluster_distance_factor=2048000] Clusters are combined if they are within 
 * this distance: cluster_distance_factor*Math.pow(2, -precision+2)
 * @constructor
 */
ClusterManager = function(map, opts) {
    var me = this;
    opts = opts || {};
    this.map = map;
    this.setMap(map);
    this.resetManager(opts);
    this.setPrecision(this.zoomToPrecision(this.map.getZoom()));
    google.maps.event.addDomListener(map, "dragstart", function() {
        me.mapDragging = true;
    });
    google.maps.event.addDomListener(map, "dragend", function() {
        me.mapDragging = false;
        me._onMapMoveEnd();
    });
    google.maps.event.addDomListener(map, "center_changed", function() {
        if (!me.mapDragging) me._onMapMoveEnd();
    });
    google.maps.event.addDomListener(map, "zoom_changed", function() {
        me._onMapMoveEnd();
    });
    if (typeof opts.markers !== "undefined") this.addMarkers(opts.markers);
};

ClusterManager.prototype = new google.maps.OverlayView();
/**
 * @ignore
 * This is implemented only so we can tell when the map is ready and to get the custom overlay 
 * functionality.
 */
ClusterManager.prototype.onAdd = function() {
    this.ready_ = true;
    google.maps.event.trigger(this, "ready_");
};

/**
 * @ignore
 */
ClusterManager.prototype.draw = function() {};

/**
 * Sets the marker and clusters back to the inital state.
 *
 * @param {object} [opts] Options for configuring the behavior of the clustering. Defaults are 
 * applied in resetManager.
 * @param {function} [opts.zoom_to_precision=function(zoom_level) {return zoom_level + precision;}] 
 * A function to set the precision for each zoom level. 
 * @param {number} [opts.precision=2] A number between 0 and 27 that sets how small the cluster 
 * boxes will be. Higher numbers will make smaller boxes.
 * @param {string|object} [opts.icon_color="00CC00"] Sets the default icon color in HEX. Default is 
 * a bright green.
 * @param {number} [opts.padding=200] The amount of padding in pixels where markers not in the 
 * viewport will still be added to the map.
 * @param {boolean} [opts.visualize=false] For debugging. Will put a box around each cluster with at 
 * least one marker.
 * @param {number} [opts.cluster_by_distance=true] Combine neighboring clusters if they are close 
 * together. This is a little slower but makes more rounded clusters.
 * @param {number} [opts.cluster_distance_factor=2048000] Clusters are combined if they are within 
 * this distance: cluster_distance_factor*Math.pow(2, -precision+2)
 */
ClusterManager.prototype.resetManager = function(opts) {
    this.markers = {}; //hold markers by type, then subtype.
    this.clusters = {}; //define clusters by precision, type, then geobox.
    this.cluster_fns = {}; //store cluster function for building the cluster markers.
    this.cluster_meta = {}; //marker counts, etc
    var precision = opts.precision >= 0 && opts.precision <= 27 ? opts.precision:2;
    opts = ClusterManager.applyDefaults({
        padding                 : 200,
        visualize               : false,
        zoom_to_precision       : function(zoom_level) {
            return zoom_level + precision;
        },
        cluster_by_distance     : true,
        cluster_distance_factor : 2048000,
        icon_color              : "00CC00"
    }, opts);
    this.opts = opts;
};

/**
 * Sets the current level of precision.
 * To speed up clustering and reduce memory, only the clusters for the current precision are 
 * calculated so changing the precision may take extra time to calculate clusters at the new 
 * precision.
 *
 * @param {number} precision The level to set the precision to. Currently, must be from 1 to 49.
 * @private
 */
ClusterManager.prototype.setPrecision = function(precision) {
    if(precision >= 50 || precision < 0) return;
    this.current_precision_ = precision;
    this.clear();
    if (typeof this.clusters[precision] === "undefined") {
        var markers = this.getMarkers();
        for(var i=0, length=markers.length; i<length; i++) { 
            var marker = markers[i];
            if (this.getMarkerMeta(marker).subtype !== "cluster") {
                this.addToCluster(marker, this.getMarkerMeta(marker).type, precision);
            }
        }
    }
    this.cluster();
    this.updateMarkers();
};

/**
 * Gets the current precision of the clusterer.
 *
 * @returns {number} The current precision.
 */
ClusterManager.prototype.getPrecision = function() {
    return this.current_precision_;
};

/**
 * Gets a hash based on latitude, longitude and precision. Higher precisions are geographically 
 * smaller areas. 
 * Since distance between degrees of longitude varies based on latitude: 
 *     (pi/180)*(6,378,137.0 meters)cos(degrees latitude)
 * the area covered by a given geohash precision will get smaller as it approaches the poles 
 * (cos(90 degrees) = 0). 
 * If you visualize the boxes, however, they will look larger based on the map projection.
 * The chart below shows the width covered by a given geohash at each precision level using 49 bits.
 * prec width		width of lat
 * 	(lat/lng)	(meters)
 * 2	140.737488	15666825.5392391m
 * 3	70.3687443	7833412.76961958m
 * 4	35.1843720	3916706.3848097343m
 * 5	17.5921860	1958353.1924048115m
 * 6	8.79609302	979176.5962023503m
 * 7	4.39804651	489588.2981011198m
 * 8	2.19902325	244794.14905050377m
 * 9	1.09951162	122397.07452519651m
 * 10	0.54975581	61198.53726254289m
 * 11	0.27487790	30599.268631216073m
 * 12	0.13743895	15299.63431555425m
 * 13	0.06871947	7649.817157720176m
 * 14	0.03435973	3824.9085788063016m
 * 15	0.01717986	1912.4542893462008m
 * 16	0.00858993	956.2271446193143m
 * 17	0.00429496	478.11357225428907m
 * 18	0.00214748	239.05678607177646m
 * 19	0.00107374	119.52839298052015m
 * 20	0.00053687	59.76419643331005m
 * 21	0.00026843	29.882098162868893m
 * 22	0.00013421	14.941049026066368m
 * 23	0.00006710	7.47052445608316m
 * 24	0.00003355	3.735262174255446m
 * 25	0.00001677	1.867631030177699m
 * 26	0.00000838	0.9338154597207706m
 * 27	0.00000419	0.46690767607425154m
 * 28	0.00000209	0.233453784250992m
 * 29	0.00000104	0.11672683517547201m
 * 30	5.24287e-7	0.05836336221965714m
 * 31	2.62142e-7	0.02918162257785948m
 * 32	1.31070e-7	0.014590754338905755m
 * 33	6.55349e-8	0.007295320219428895m
 * 34	3.27669e-8	0.0036476047416355755m
 * 35	1.63829e-8	0.0018237454207938048m
 * 36	8.19099e-9	0.0009118173423180302m
 * 37	4.09499e-9	0.0004558533030801429m
 * 38	2.04701e-9	0.00022787286540630993m
 * 39	1.02301e-9	0.0001138810646242828m
 * 40	5.10993e-10	0.00005688358228815859m
 * 41	2.54999e-10	0.000028386423065207123m
 * 42	1.27016e-10	0.000014139425398842023m
 * 43	6.30109e-11	0.00000701434462054884m
 * 44	3.10080e-11	0.0000034518042314022482m
 * 45	1.50066e-11	0.0000016705340368289525m
 * 46	6.99174e-12	7.783169944316711e-7m
 * 47	3.01270e-12	3.353723634542973e-7m
 * 48	9.94759e-13	1.1073615774434343e-7m
 * 
 * @param {number} lat Latitude. Value is clamped to the nearest value in [-90.0, 90.0];
 * @param {number} lng Longitude. Value is wrapped to stay within [-180, 180);
 * @param {number} precision An integer representing the number of bits to take from the 
 *                           untruncated latitude and longitude hashes.
 * @returns {string} geohash A binary hash string with a length twice the precision.
 */
ClusterManager.prototype.getGeohash = function(lat, lng, precision) {
    lat = Math.min(lat, 90.0);
    lat = Math.max(lat, -90.0);
    lng = Math.abs((lng+180.0)%360.0) - 180.0;

    if (precision <= 0) return "";
    var max_power = 12; //This is the limit for maximum range of decimal numbers in javascript.
    // Make the latitude and longitude positive and then mulitiply them by 10^12 to get rid of
    // as many decimal places as possible. Then change this to binary.
    var latBase = parseInt((lat + 90.0) * (Math.pow(10, max_power))).toString(2);
    var lngBase = parseInt((lng + 180.0) * (Math.pow(10, max_power))).toString(2);
    //Pad the front with zeros to make sure latitude and longitude are 49 bits.
    var fortyninezeros = "0000000000000000000000000000000000000000000000000";
    var latHash = fortyninezeros.substr(0, 49 - latBase.length) + latBase;
    var lngHash = fortyninezeros.substr(0, 49 - lngBase.length) + lngBase;
    //Take bits from the front based on the precision. 
    //Concatinate the latitude and longitude strings.
    var geohash = latHash.substr(0, precision) + lngHash.substr(0, precision);
    return geohash;
};

/**
 * Given a geohash, this returns the bounds on it's range. The inverse of getGeohash.
 * 
 * @param {string} geohash A string representing the geobox.
 * @returns {google.maps.LatLngBounds} The bounds on the geobox. 
 */
ClusterManager.prototype.geohashGetLatLngBounds = function(geohash) {
    var max_power = 12;
    var precision = this.geohashGetPrecision(geohash);
    var fortyninezeros = "0000000000000000000000000000000000000000000000000";
    var latMinHashBin = geohash.substr(0, precision) + fortyninezeros.substr(0, 49 - precision);
    var lngMinHashBin = geohash.substr(precision, geohash.length) +
                        fortyninezeros.substr(0, 49 - precision);
    var fortynineones = "1111111111111111111111111111111111111111111111111";
    var latMaxHashBin = geohash.substr(0, precision) + fortynineones.substr(0, 49 - precision);
    var lngMaxHashBin = geohash.substr(precision, geohash.length) +
                        fortynineones.substr(0, 49 - precision);
    var latMinHashDec = parseInt(latMinHashBin, 2);
    var lngMinHashDec = parseInt(lngMinHashBin, 2);
    var latMaxHashDec = parseInt(latMaxHashBin, 2);
    var lngMaxHashDec = parseInt(lngMaxHashBin, 2);
    var latMin = Math.max(-90.0,  (latMinHashDec / Math.pow(10, max_power)) - 90);
    var lngMin = Math.max(-180.0, (lngMinHashDec / Math.pow(10, max_power)) - 180);
    var latMax = Math.min(90.0,   (latMaxHashDec / Math.pow(10, max_power)) - 90);
    var lngMax = Math.min(180.0,  (lngMaxHashDec / Math.pow(10, max_power)) - 180);
    return new google.maps.LatLngBounds(new google.maps.LatLng(latMin, lngMin), 
                                        new google.maps.LatLng(latMax, lngMax));
};

/**
 * Derives the precision from a geohash string.
 *
 * @param {string} geohash The geohash to find the precision of.
 * @returns {number} The derived precision of the geobox.
 * @private
 */
ClusterManager.prototype.geohashGetPrecision = function(geohash) {
    var precision = geohash.length / 2;
    if (parseInt(precision) !== precision || precision < 0 || precision >= 50) return undefined;
    return precision;
};

/**
 * Gets the boxes surrounding the given box and only returns boxes that have at least one marker.
 *
 * @param {string} box_str The geobox to find the neighbors of.
 * @param {string} type The type of the geobox to find the neighbors of.
 * @returns {string[]} The strings for the geoboxes with at least one marker neighboring the input 
 * geobox.
 * @private
 */
ClusterManager.prototype.getNeighborBoxes = function(box_str, type) {
    var bounds = this.geohashGetLatLngBounds(box_str);
    var precision = this.geohashGetPrecision(box_str);
    var boxString1 = this.getGeohash(bounds.getSouthWest().lat() + 0.0001, 
                                     bounds.getSouthWest().lng() - 0.0001, precision);
    var boxString2 = this.getGeohash(bounds.getSouthWest().lat() - 0.0001, 
                                     bounds.getSouthWest().lng() + 0.0001, precision);
    var boxString3 = this.getGeohash(bounds.getNorthEast().lat() + 0.0001, 
                                     bounds.getNorthEast().lng() - 0.0001, precision);
    var boxString4 = this.getGeohash(bounds.getNorthEast().lat() - 0.0001, 
                                     bounds.getNorthEast().lng() + 0.0001, precision);
    var boxString5 = this.getGeohash(bounds.getSouthWest().lat() + 0.0001, 
                                     bounds.getSouthWest().lng() + 0.0001, precision);
    var boxString6 = this.getGeohash(bounds.getSouthWest().lat() - 0.0001, 
                                     bounds.getSouthWest().lng() - 0.0001, precision);
    var boxString7 = this.getGeohash(bounds.getNorthEast().lat() + 0.0001, 
                                     bounds.getNorthEast().lng() + 0.0001, precision);
    var boxString8 = this.getGeohash(bounds.getNorthEast().lat() - 0.0001, 
                                     bounds.getNorthEast().lng() - 0.0001, precision);
    var boxStrings = [boxString1, boxString2, boxString3, boxString4, boxString5, boxString6, 
                      boxString7, boxString8];
    for (var i = 0, neighbors = [], boxString; boxString = boxStrings[i]; i++) {
        if (typeof this.clusters[precision][type][boxString] !== "undefined" && boxString !== box_str) {
            neighbors.push(boxString);
        }
    }
    return neighbors;
};

/**
 * Given a geohash, this returns a polygon covering the box's bounds. Mostly for debugging to 
 * visualize geoboxes.
 *
 * @param {string} geohash A string representing the geobox.
 * @param {object} [opts] Options for the appearance of the polygon.
 * @param {GMap3}  [opts.map=this.map] The map to add the polygon to.
 * @param {string} [opts.strokeColor] 
 * @param {string} [opts.strokeWeight]
 * @param {string} [opts.strokeOpacity] 
 * @param {string} [opts.fillColor] 
 * @param {string} [opts.fillOpacity] .
 * @returns {google.maps.Polygon} A polygon covering the box's bounds.
 */
ClusterManager.prototype.boxToPolygon = function(geohash, opts) {
    opts = ClusterManager.applyDefaults({
        map           : this.map,
        strokeColor   : "#f33f00",
        strokeWeight  : 5,
        strokeOpacity : 1,
        fillColor     : "#ff0000",
        fillOpacity   : 0.2
    }, opts);
    var bounds = this.geohashGetLatLngBounds(geohash);  //TODO:change back!!
    var ne = bounds.getNorthEast();
    var sw = bounds.getSouthWest();
    var polygon = new google.maps.Polygon({
        paths         : opts.paths || [ne, new google.maps.LatLng(ne.lat(), sw.lng()), sw, 
                         new google.maps.LatLng(sw.lat(), ne.lng()), ne],
        strokeColor   : opts.strokeColor,
        strokeWeight  : opts.strokeWeight,
        strokeOpacity : opts.strokeOpacity,
        fillColor     : opts.fillColor,
        fillOpacity   : opts.fillOpacity,
        map           : opts.map
    });
    return polygon;
};

/**
 * Tests whether a geobox touches a given bounds. Padding expands the range of the bounds based on 
 * viewport pixels.
 *
 * @param {string} geohash A string representing the geobox.
 * @param {google.maps.LatLngBounds} bounds The bounds to be tested.
 * @param {number} [padding] The number of pixels to expand the bounds. 
 * @returns {boolean} True if any part of the geobox touches the bounds expanded by the padding.
 * @private
 */
ClusterManager.prototype.boxInBounds = function(geohash, bounds, padding) {
    //make a new LatLngBounds so we don't have any side effects on our map bounds.
    var newBounds = new google.maps.LatLngBounds(this.map.getBounds().getSouthWest(), 
                                                 this.map.getBounds().getNorthEast());
    if (typeof padding !== "undefined") {
        var proj = this.map.getProjection();
        var scale = Math.pow(2, this.map.getZoom());
        var pixelOffset = new google.maps.Point((padding / scale) || 0, (padding / scale) || 0);
        var nePoint = proj.fromLatLngToPoint(bounds.getNorthEast());
        var swPoint = proj.fromLatLngToPoint(bounds.getSouthWest());
        var newNEPoint = new google.maps.Point(nePoint.x + pixelOffset.x, 
                                               nePoint.y - pixelOffset.y);
        var newSWPoint = new google.maps.Point(swPoint.x - pixelOffset.x, 
                                               swPoint.y + pixelOffset.y);
        var newNE = proj.fromPointToLatLng(newNEPoint);
        var newSW = proj.fromPointToLatLng(newSWPoint);
        newBounds.extend(newNE);
        newBounds.extend(newSW);
    }
    var boxBounds = this.geohashGetLatLngBounds(geohash);
    if (newBounds.contains(boxBounds.getNorthEast()) || 
        newBounds.contains(boxBounds.getSouthWest()) || 
        boxBounds.toSpan().lat() === 180) return true;
    else return false;
};

/**
 * Use this to add markers in one batch through an array.
 *
 * @param {google.maps.Marker[]} markers An array of markers.
 * @param {string} type The type for the markers being added.
 * @param {string} subtype The subtype for the markers being added.
 */
ClusterManager.prototype.addMarkers = function(markers, type, subtype) {
    if (Object.prototype.toString.call(markers) === '[object Array]') {

        for(var i=0, length=markers.length; i<length; i++) { 
            var marker = markers[i];
            this.addMarker(marker, {
                "type"    : type,
                "subtype" : subtype
            });
        }
    }
};

/**
 * Add a single marker to the map. Stores an associative array for looking for marker types so we 
 * can cluster by type. Doesn't build clusters or add them to the map. Each marker can have an opt 
 * type and subtype to cluster by. 
 *
 * @param {google.maps.Marker} marker The marker to add. 
 * @param {object} [opts] Options for the behavior of the marker in the clusters.
 * @param {string} [opts.type] A string that is used to sort which markers to cluster.
 * @param {string} [opts.subtype] A string that is used to show/hide subsets of markers of a given 
 * type.
 * @param {boolean} [opts.hidden] Set true to make a marker disappear from the map even if it's in 
 * the viewport.
 * @param {boolean} [opts.visible] Set true if the marker is visible in the viewport. 
 * @param {string} [opts.summary] The summary text that appears in the cluster's infowindow. 
 * Clicking on the text opens the markers infowindow.
 */
ClusterManager.prototype.addMarker = function(marker, opts) {
    if (typeof opts === "undefined") opts = this.getMarkerMeta(marker);
    //Set when the marker is visible in the viewport and not hidden.
    //Set when we want to hide the marker even if it's in the viewport.
    var defaults = {
        type    : "generic",
        subtype : "generic",
        hidden  : true,
        visible : false
    };
    opts = ClusterManager.applyDefaults(defaults, opts);
    var type = opts.type,
        subtype = opts.subtype;
    //if this is the first marker of the type, save the cluster function.
    if (typeof this.markers[type] === "undefined") {
        this.markers[type] = {};
        this.cluster_meta[type] = {
            count: {
                total   : 0,
                visible : 0,
                cluster : 0
            }
        };
    }
    if (typeof this.cluster_fns[type] === "undefined") {
        this.setClusterFn(type, this.createClusterMarker);
    }
    //if this is the first marker of the subtype, set up an empty array to save it in.
    if (typeof this.markers[type][subtype] === "undefined") {
        this.markers[type][subtype] = [];
    }
    this.markers[type][subtype].push(marker);
    if (subtype !== "cluster") {
        this.cluster_meta[type]["count"]["total"] += 1;
        this.addToCluster(marker, type, this.getPrecision());
    }
    if (typeof opts.summary === "undefined") {
        var capType = opts.type.charAt(0).toUpperCase() + opts.type.slice(1);
        opts.summary = typeof marker.getTitle() === "undefined" ? capType + " marker " +
                       this.count(opts.type, "total") : marker.getTitle();
    }
    this.setMarkerMeta(marker, opts);
};

/**
 * Returns the number of markers of a particular type.
 *
 * @param {number} type The type of marker to count.
 * @returns {number} The number of markers of a particular type.
 */
ClusterManager.prototype.count = function(type, count_type) {
    return this.cluster_meta[type]["count"][count_type];
};

/**
 * Adds a marker to a cluster object. Does not create the cluster markers.
 *
 * @param {google.maps.Marker} marker The marker to add. 
 * @param {string} type The type of the marker to add. This will be used to form cluster groups. If 
 * no type is given it is assigned type "generic".
 * @param {number} precision The precision to cluster at.
 * @param {string} [geohash] Force a marker into a particular geobox rather than its default one.
 * @private
 */
ClusterManager.prototype.addToCluster = function(marker, type, precision, geohash) {
    var clusters = this.clusters;
    var markerLL = marker.getPosition();
    var markerLat = markerLL.lat();
    var markerLng = markerLL.lng();
    if (typeof clusters[precision] === "undefined") {
        clusters[precision] = {};
    }
    if (typeof clusters[precision][type] === "undefined") {
        clusters[precision][type] = {};
    }
    var cluster = clusters[precision][type];
    if (typeof geohash === "undefined") {
        geohash = this.getGeohash(markerLat, markerLng, precision);
    }
    if (typeof cluster[geohash] !== "undefined") {
        cluster[geohash]["markers"].push(marker);
        var length = cluster[geohash]["markers"].length;
        var lat = ((length - 1) / length) * cluster[geohash]["center"][0] + markerLat / length;
        var lng = ((length - 1) / length) * cluster[geohash]["center"][1] + markerLng / length;
        cluster[geohash]["center"] = [lat, lng];
    } else {
        cluster[geohash] = {
            cluster : false,
            markers : [marker],
            center  : [markerLat, markerLng]
        };
    }
};

/**
 * Removes a marker from a cluster and resets the cluster box's properties.
 *
 * @param {google.maps.Marker} marker The marker to remove.
 * @param {string} geohash The geohash to remove the marker from.
 * @private
 */
ClusterManager.prototype.removeFromCluster = function(marker, geohash) {
    var precision = this.geohashGetPrecision(geohash);
    var type = this.getMarkerMeta(marker).type;
    var geoBox = this.clusters[precision][type][geohash];
    if (geoBox["markers"].length === 1) {
        delete(this.clusters[precision][type][geohash]);
    } else if (geoBox["markers"].length > 1) {
        for (var i=0, new_markers=[], center_lat=0, center_lng=0, test_marker; 
             test_marker = geoBox["markers"][i]; i++) {
            if (test_marker !== marker) {
                new_markers.push(test_marker);
                center_lat = center_lat + test_marker.getPosition().lat();
                center_lng = center_lng + test_marker.getPosition().lng();
            }
        }
        center_lat = center_lat / new_markers.length;
        center_lng = center_lng / new_markers.length;
        geoBox["center"] = [center_lat, center_lng];
        geoBox["markers"] = new_markers;
        geoBox["cluster"] = false;
        this.clusters[precision][type][geohash] = geoBox;
    }
};

/**
 * This takes two geoboxes and puts all the markers into the one with more markers or the first one.
 * 
 * @param {string} box_str1 First box to combine.
 * @param {string} box_str2 Second box to combine.
 * @param {string} type Type of the boxes since this can't be derived.
 * @private
 */
ClusterManager.prototype.combineBoxes = function(box_str1, box_str2, type) {
    var precision = this.geohashGetPrecision(box_str1);
    if (this.clusters[precision][type][box_str1]["markers"].length < 
        this.clusters[precision][type][box_str2]["markers"].length) {
        var temp = box_str1;
        box_str1 = box_str2;
        box_str2 = temp;
    }
    var length = this.clusters[precision][type][box_str2]["markers"].length;
    for (var i = length - 1, marker; i >= 0; i--) {
        marker = this.clusters[precision][type][box_str2]["markers"][i];
        this.removeFromCluster(marker, box_str2);
        this.addToCluster(marker, type, precision, box_str1);
    }
};

/**
 * This checks neighboring geoboxes to see if they are centered within a minimum distance. This 
 * makes the clusters less box shaped, but also takes extra time.
 * 
 * @param {string} type The type of the markers to cluster.
 * @private
 */
ClusterManager.prototype.combineClustersByDistance = function(type) {
    var precision = this.getPrecision();
    var clusters = this.clusters;
    var clusterDistanceFactor = this.opts.cluster_distance_factor || 2048000;
    for (var boxStr in clusters[precision][type]) {
        var neighbors = this.getNeighborBoxes(boxStr, type);
        var distance = clusterDistanceFactor * Math.pow(2, -precision + 2);
        var clusterCenter = clusters[precision][type][boxStr]["center"];
/***
        new google.maps.Circle({
                strokeColor   : '#FF0000',
                strokeOpacity : 0.8,
                strokeWeight  : 2,
                fillColor     : '#FF0000',
                fillOpacity   : 0.35,
                map           : this.map,
                center        : new google.maps.LatLng(clusterCenter[0], clusterCenter[1]),
                radius        : distance});
***/
        for (var j = 0, result = 0, neighborStr; neighborStr = neighbors[j]; j++) {
            clusterCenter = clusters[precision][type][boxStr]["center"];
            var neighborCenter = clusters[precision][type][neighborStr]["center"];
            var currentDist = google.maps.geometry.spherical.computeDistanceBetween(
                              new google.maps.LatLng(clusterCenter[0], clusterCenter[1]), 
                              new google.maps.LatLng(neighborCenter[0], neighborCenter[1]));
            if (currentDist < distance) {
                result = j;
                distance = currentDist;
            }
        }
        if (result) {
            neighborStr = neighbors[result];
            this.combineBoxes(boxStr, neighborStr, type);
        }
    }
};

/**
 * This builds the actual cluster markers and optionally combines boxes if the markers get too close 
 * together. It does not set up the cluster dictionary.
 *
 * @param {string} [type] The type to cluster. If none is given, this sets up the clusters for every 
 * group in the clusterer.
 * @private
 */
ClusterManager.prototype.cluster = function(type) {
    var precision = this.getPrecision();
    var clusters,
        marker,
        cluster_markers,
        i;
    if (typeof type === "undefined") {
        clusters = this.clusters[precision];
        for (type in clusters) {
            this.cluster(type);
        }
        return;
    }
    if (typeof this.markers[type] === "undefined") return; //no markers to cluster
    if (typeof this.markers[type]["cluster"] !== "undefined") {
        for (i = 0, marker; marker = this.markers[type]["cluster"][i]; i++) {
            marker.setVisible(false);
        }
    }
    this.markers[type]["cluster"] = [];
    this.cluster_meta[type]["count"]["cluster"] = 0;
    clusters = this.clusters;
    if (this.opts.cluster_by_distance) this.combineClustersByDistance(type);
    for (var boxStr in clusters[precision][type]) {
        //visualize the boxes by adding polygons to the map for debugging.
        if (this.opts.visualize) this.boxToPolygon(boxStr).setMap(this.map);
        var cluster = clusters[precision][type][boxStr];
        for (i = 0, cluster_markers = []; marker = cluster["markers"][i]; i++) {
            var meta = this.getMarkerMeta(marker);
            if (typeof meta.hidden === "undefined" || !meta.hidden) {
                cluster_markers.push(marker);
            }
        }
        if (cluster_markers.length > 1) {
            cluster["cluster"] = this.cluster_fns[type](cluster_markers, cluster["center"][0], 
                                                        cluster["center"][1], this);
            this.addMarker(cluster["cluster"], {
                type    : type,
                subtype : "cluster",
                hidden  : false
            });
            this.cluster_meta[type]["count"]["cluster"] += 1;
        } else {
            cluster["cluster"] = false;
        }
    }
};

/**
 * Gets the markers of a given type and/or subtype. Returns all markers if passed no parameters.
 *
 * @param {string} [type] The type of the markers to return.
 * @param {string} [subtype] The subtype of the markers to return.
 * @param {string|boolean} [visible] Pass "all" to get markers that aren't clusters.
                                     Pass true to get all markers that are visible and not hidden.
 * @returns {google.maps.Marker[]} The markers of the given type.
 */
ClusterManager.prototype.getMarkers = function(type, subtype, visible) {
    var markers = [];
    if (this.markers === {}) return []; //no markers of any type.
    if (typeof type === "undefined") {
        for (type in this.markers) {
            for (subtype in this.markers[type]) {
                markers = markers.concat(this.markers[type][subtype]);
            }
        }
    } else if (typeof subtype === "undefined") {
        for (subtype in this.markers[type]) {
            //access all subcategories with a string.
            markers = markers.concat(this.markers[type][subtype]); 
        }
    } else {
        try {
            markers = this.markers[type][subtype] || [];
        } catch (err) {
            markers = [];
        }
    }
    if (typeof visible === "undefined") return markers;

    for (var i=0, final_markers=[], length=markers.length; i<length; i++) {
        var marker = markers[i];
        var meta = this.getMarkerMeta(marker);
        if (visible === "all" || meta.hidden !== visible && meta.visible === visible && 
            typeof marker !== "function" && meta.type !== "cluster") {
            final_markers.push(marker);
        }
    }
    return final_markers;
};

/**
 * Handles any change in the map viewport. Calls updateMarkers with a timeout so it doesn't lock up 
 * the map.
 * @private
 */
ClusterManager.prototype._onMapMoveEnd = function() {
    var me = this;
    if (typeof me.moveTimeout !== "undefined") {
        clearTimeout(me.moveTimeout);
        delete(me.moveTimeout);
    }
    var precision = me.zoomToPrecision(me.map.getZoom());
    if (me.getPrecision() !== precision) {
        me.setPrecision(precision);
    } else {
        me.moveTimeout = setTimeout(function() {
            delete(me.moveTimeout);
            me.updateMarkers();
        }, 100);
    }
};

/**
 * Shows markers of an input type.
 *
 * @param {string} type The type of markers to show.
 * @param {string} subtype The subtype of markers to show.
 */
ClusterManager.prototype.show = function(type, subtype) {
    this._showHide(type, subtype, false);
};

/**
 * Hides markers of the input type.
 *
 * @param {string} type The type of markers to hide.
 * @param {string} subtype The subtype of markers to hide.
 */
ClusterManager.prototype.hide = function(type, subtype) {
    this._showHide(type, subtype, true);
};

/**
 * Does the actual showing or hiding.
 * @private
 */
ClusterManager.prototype._showHide = function(type, subtype, hide) {
    var me = this;
    var markers = this.getMarkers(type, subtype);
    for(var i=0, length=markers.length; i<length; i++) { 
        var marker = markers[i];
        this.getMarkerMeta(marker).hidden = hide;
    }
    if (this.ready_) this._lagUpdate(type);
    else {
        google.maps.event.addListenerOnce(this, "ready_", function() {
            me._lagUpdate(type);
        });
    }
};

/**
 * Since clustering takes time, this sets up a delay before reclustering.
 * 
 * @param {string} type The type to update.
 * @private
 */
ClusterManager.prototype._lagUpdate = function(type) {
    var me = this;
    if (typeof this.processingTimeout !== "undefined") {
        clearTimeout(me.processingTimeout);
        delete(me.processingTimeout);
    }
    this.processingTimeout = setTimeout(function() {
        delete(me.processingTimeout);
        me.clear(type);
        me.cluster(type);
        me.updateMarkers();
    }, 100);
};

/**
 * This sets a cluster type to an empty state.
 *
 * @param {string} [type] The type to reset. If none is given, every type in the clusterer is reset.
 */
ClusterManager.prototype.reset = function(type) {
    if(typeof type === "undefined") {
        var clusters = this.clusters[this.getPrecision()];
        for(type in clusters) {
            this.reset(type);
        }
        return;
    }
    this.clear(type);
    //this for loop should probably be a reset cluster function
    for(var precision in this.clusters) {
        delete(this.clusters[precision][type]);
        this.clusters[precision][type] = {};
    }
    delete(this.markers[type]);
    this.markers[type] = {};
};

/**
 * This removes the markers from the map. Use reset if you want to actually get rid of the 
 * markers.
 *  
 * @param {string} [type] The type to clear. If it is not passed, all markers managed by the 
 * clusterer will be cleared.
 */
ClusterManager.prototype.clear = function(type) {
    var markers = this.getMarkers(type);
    for(var i=0, length=markers.length; i<length; i++) { 
        var marker = markers[i];
        marker.setMap(null);
        this.getMarkerMeta(marker).visible = false;
    }
    if (typeof type !== "undefined" && this.cluster_meta && this.cluster_meta[type]) {
        this.cluster_meta[type]["count"]["visible"] = 0;
    } else {
        for (var item in this.cluster_meta) {
            this.cluster_meta[item]["count"]["visible"] = 0;
        }
    }
};

/**
 * Convert a Google map zoom level to a clusterer precision.
 *
 * @param {number} zoom_level The Google map's zoom level
 * @returns {number} The precision of the input zoom level. 
 */
ClusterManager.prototype.zoomToPrecision = function(zoom_level) {
    return this.opts.zoom_to_precision(zoom_level);
};

/**
 * Updates the markers on the map based on the current viewport with padding.
 * @private
 */
ClusterManager.prototype.updateMarkers = function() {
    var marker,
        meta,
        length,
        i;
    var precision = this.getPrecision();
    var currentBounds = this.map.getBounds();
    var cluster = this.clusters[precision];
    for (var type in cluster) {
        var type_cluster = cluster[type];
        for (var box in type_cluster) {
            var cluster_box = type_cluster[box];
            var cluster_box_meta = this.getMarkerMeta(cluster_box["cluster"]);
            if (this.boxInBounds(box, currentBounds, this.opts.padding)) {
                if (cluster_box["cluster"]) {
                    if (!cluster_box_meta.hidden && !cluster_box_meta.visible) {
                        for(i=0, length=cluster_box["markers"].length; i<length; i++) { 
                            marker = cluster_box["markers"][i];
                            this.getMarkerMeta(marker).visible = true;
                        }
                        cluster_box["cluster"].setMap(this.map);
                        cluster_box["cluster"].setVisible(true);
                        cluster_box_meta.visible = true;
                        this.cluster_meta[type]["count"]["visible"] += 1;
                    }
                } else {
                    marker = cluster_box["markers"][0];
                    meta = this.getMarkerMeta(marker);
                    if (!meta.hidden && !meta.visible) {
                        marker.setMap(this.map);
                        marker.setVisible(true);
                        meta.visible = true;
                        this.cluster_meta[type]["count"]["visible"] += 1;
                    }
                }
            } else {
                if (cluster_box["cluster"]) {
                    cluster_box["cluster"].setVisible(false);
                    if (cluster_box_meta.visible) this.cluster_meta[type]["count"]["visible"] -= 1;
                    cluster_box_meta.visible = false;
                } else {
                    for(i=0, length=cluster_box["markers"].length; i<length; i++) { 
                        marker = cluster_box["markers"][i];
                        meta = this.getMarkerMeta(marker);
                        marker.setVisible(false);
                        if (meta.visible) this.cluster_meta[type]["count"]["visible"] -= 1;
                        meta.visible = false;
                    }
                }
            }
        }
    }
};

/**
 * Sets the clustering function for a given type of markers. 
 * 
 * @param {string} type The type the clustering function is set up for.
 * @param {function} fn The function that is used to cluster the markers. See
 *                      ClusterManager.createClusterMarker for an example of
 *                      its parameters and return value.
 */
ClusterManager.prototype.setClusterFn = function(type, fn) {
    this.cluster_fns[type] = fn;
};

/**
 * Sets a marker's meta properties. Properties already set are treated as defaults.
 * 
 * @param {google.maps.Marker} marker
 * @param {object} meta
 */
ClusterManager.prototype.setMarkerMeta = function(marker, meta) {
    var defaults = ClusterManager.applyDefaults(meta, marker._cluster_meta);
    marker._cluster_meta = ClusterManager.applyDefaults(defaults, meta);
};

/**
 * Gets a marker's meta properties.
 * 
 * @param {google.maps.Marker} marker
 * @returns {object} The object with extra data about the marker.
 */
ClusterManager.prototype.getMarkerMeta = function(marker) {
    try {
        return marker._cluster_meta;
    } catch (err) {
        marker._cluster_meta = {};
        return marker._cluster_meta;
    }
};

/**
 * A free function for creating cluster icons. At precisions greater than 10, the markers will be
 * precise looking pins. At precisions less then 10, the markers will be circles that float above
 * the map.
 * 
 * @param {number} number The number of markers in the cluster.
 * @param {number} precision The precision of markers.
 * @param {string} icon_color A HEX color for the marker.
 * @param {string} [text_color="000000"] A HEX color for the text inside the markers.
 * @returns {object} An object containing the configuration options for a cluster icon.
 */
ClusterManager.prototype.createClusterIcon = function(number, precision, icon_color, text_color) {
    var iconOpts;
    text_color = text_color || "000000";
    if (precision > 10) {
        iconOpts = {
            "url"  : 'http://chart.apis.google.com/chart?cht=d&chdp=mapsapi&chl=pin%27i\\%27[' + 
                      number + '%27-2%27f\\hv%27a\\]h\\]o\\' + icon_color + '%27fC\\' + text_color + 
                      '%27tC\\000000%27eC\\Lauto%27f\\&ext=.png',
            "size" : new google.maps.Size(21, 34)
        };
    } else {
        var size = ((number + "").length - 1) * 6 + 24;
        iconOpts = {
            "size"   : new google.maps.Size(size, size),
            "anchor" : new google.maps.Point(size/2, size/2),
            "shape"  : {
                coord : [size/2, size/2, size/2],
                type  : "circle"
            },
            "url"    : "http://chart.apis.google.com/chart?cht=it&chs=" + size + "x" + size +
                       "&chco=" + icon_color + ",000000ff,ffffff01&chl=" + number + "&chx=" + 
                        text_color + ",0&chf=bg,s,00000000&ext=.png"
        };
    }
    return this.createMarkerIconOpts(iconOpts);
};

/**
 * A free function for creating cluster markers.
 * 
 * @param {google.maps.Marker[]} marker_list An array of markers to make a cluster icon for.
 * @param {number} center_lat The center latitude of the cluster.
 * @param {number} center_lng The center longitude of the cluster.
 * @param {ClusterManager} manager The ClusterManager object managing the cluster.
 * @returns {google.maps.Marker} The new cluster marker.
 */
ClusterManager.prototype.createClusterMarker = function(marker_list, center_lat, center_lng, manager) {
    var htmlEl = document.createElement("div");
    htmlEl.style.width = "400px";

    function markerClickClosure(marker) {
        return function(e) {
            google.maps.event.trigger(marker, "click", e);
        };
    }
    for (var i = 0, marker; marker = marker_list[i]; i++) {
        var markerSpan = document.createElement("span");
        markerSpan.innerHTML = '<b>' + manager.getMarkerMeta(marker).summary + '</b><br>';
        markerSpan.onclick = markerClickClosure(marker);
        markerSpan.style.color = "#334499";
        markerSpan.style.cursor = "pointer";
        htmlEl.appendChild(markerSpan);
        if (i >= 9) break;
    }
    if (marker_list.length > 10) {
        htmlEl.appendChild(document.createTextNode((marker_list.length - 10) + 
                           " more markers in this area. Zoom in for details."));
    }
    var icon_color = manager.opts.icon_color[manager.getMarkerMeta(marker_list[0]).type] || 
                                                                   manager.opts.icon_color;
    var icon = manager.createClusterIcon(marker_list.length, manager.getPrecision(), icon_color);
    marker = manager.createMarker({
        "position" : new google.maps.LatLng(center_lat, center_lng),
        "title"    : marker_list.length + " markers",
        "content"  : htmlEl,
        "summary"  : marker_list.length + " markers",
        "icon"     : icon,
        "shape"    : icon["shape"],
        "zIndex"   : marker_list.length
    });
    return marker;
};

/**
 * A free function for creating marker icon opts.
 * 
 * @param {object} [opts] Options for configuring the appearance of the marker icon.
 * @param {number} [opts.width=32] The width of the icon.
 * @param {number} [opts.height=32] The height of the icon.
 * @param {string|object} [opts.icon_color="ff0000"] The HEX color of the icon or an associate array 
 * with a color for corresponding marker types.
 * @param {string} [opts.type] A type for the marker.
 * @param {string} [opts.strokeColor="000000"] The HEX color for icon's stroke.
 * @param {string} [opts.cornerColor="ffffff"] The HEX color for icon's corner.
 * @returns {object} An object that can be used to create a map icon.
 */
ClusterManager.prototype.createMarkerIconOpts = function(opts) {
    if (typeof opts === "undefined") opts = {};
    if (typeof opts.width === "undefined") opts.width = 32;
    if (typeof opts.height === "undefined") opts.height = 32;
    var width = opts.width,
        height = opts.height;
    //Set the icon color.
    //First check the options.
    var icon_color;
    if (typeof opts.icon_color !== "undefined") {
        if (typeof opts.icon_color === "object" && typeof opts.type !== "undefined") {
            icon_color = opts.icon_color[opts.type] || "ff0000";
        } else {
            icon_color = opts.icon_color;
        }
    //Then try the cluster manager options.
    } else if (typeof opts.type !== "undefined" && typeof this.opts.icon_color === "object") {
        icon_color = this.opts.icon_color[opts.type] || "ff0000";
    } else {
        icon_color = this.opts.icon_color || "ff0000";
    }
    if (typeof opts.strokeColor === "undefined") opts.strokeColor = "000000";
    if (typeof opts.cornerColor === "undefined") opts.cornerColor = "ffffff";
    var baseUrl = "http://chart.apis.google.com/chart?cht=mm";
    var iconUrl = baseUrl + "&chs=" + width + "x" + height + "&chco=" +
                 opts.cornerColor.replace("#", "") + "," + icon_color + "," +
                 opts.strokeColor.replace("#", "") + "&ext=.png";

    return ClusterManager.applyDefaults({
        url    : iconUrl,
        size   : new google.maps.Size(width, height),
        origin : new google.maps.Point(0, 0),
        anchor : new google.maps.Point(width/2, height)
    }, opts);
};

/**
 * A free function for creating markers. In addition to the parameters below, you can pass any 
 * option listed in Google's reference:
 * https://developers.google.com/maps/documentation/javascript/reference#MarkerOptions
 * 
 * @param {object} [opts] Options for configuring the marker. 
 * @param {google.maps.Map} [opts.map=this.map] The map on which to display the marker. 
 * @param {boolean} [opts.visible=false] Make the marker visible initially.
 * @param {object} [opts.icon=this.createMarkerIconOpts(opts)] The marker's icon.
 * @param {function} [opts.fn] A function called when the marker is clicked.
 * @param {string} [opts.content="Marker"] If the marker does not have opts.fn defined, this 
 * determines the content of the infowindow displayed when the marker is clicked.
 */
ClusterManager.prototype.createMarker = function(opts) {
    var me = this;
    var defaultIconOpts = this.createMarkerIconOpts(opts);
    var defaults = {
        "map"     : this.map,
        "visible" : false,
        "icon"    : defaultIconOpts,
        "content" : "Marker"
    };
    opts = ClusterManager.applyDefaults(defaults, opts);
    var marker = new google.maps.Marker(opts);
    if (typeof opts.fn === "undefined") {
        var iw = new google.maps.InfoWindow({
            content: opts.content
        });
        google.maps.event.addListener(marker, 'click', function() {
            var now = new Date();
            iw.setZIndex(now.getTime());
            iw.open(me.map, marker);
        });
    } else {
        google.maps.event.addListener(marker, 'click', opts.fn);
    }
    this.setMarkerMeta(marker, opts);
    return marker;
};

/**
 * Tool for applying defaults. Any property in defaults will be overwritten by a corresponding
 * property in opts. If the property does not exist, the default remains. Only properties in 
 * defaults will be included in the final object.
 * 
 * @param {object} [defaults]
 * @param {object} [opts]
 * @returns {object} 
 */
ClusterManager.applyDefaults = function(defaults, opts) {
    if (typeof defaults !== "object") return {};
    if (typeof opts !== "object") return defaults;
    for (var index in defaults) {
        if (typeof opts[index] === "undefined") {
            opts[index] = defaults[index];
        }
    }
    return opts;
};

YAHOO.namespace("OCRPanel");

/************************************************************************************************
 * MMI Resizable Panel
 ************************************************************************************************/

/**
 * The OCRPanel module provides a widget for creating a panel
 * with a look and features for ocregister.com.
 *
 * @module ocrpanel
 * @requires yahoo, dom, dragdrop, event, element, resize, animation, container, calendar
 * @namespace YAHOO.widget
 * @title OCRPanel Widget
 **/
(function () {

    var WidgetName;             // forward declaration

    /**
     * The OCRPanel widget.
     *
     * @class OCRPanel
     * @extends YAHOO.widget.Panel
     * @constructor
     * @param el {HTMLElement | String} The HTML element that represents the
     * the container that houses the panel.
     * @param cfg {Object} (optional) The configuration values
     */
    YAHOO.widget.OCRPanel = function(el, userConfig) {

        this._Btns = {};

        YAHOO.widget.OCRPanel.superclass.constructor.call(this, el, userConfig);
    };

    /*
     * Private variables of the ResizePanel component
     */

    /* Some abbreviations to avoid lengthy typing and lookups. */
    var OCRPanel = YAHOO.widget.OCRPanel,
        Panel    = YAHOO.widget.Panel,
        Dom      = YAHOO.util.Dom,
        Event    = YAHOO.util.Event,
        Get      = YAHOO.util.Get,
        Motion   = YAHOO.util.Motion,
        Lang     = YAHOO.lang,
        UA       = YAHOO.env.ua,

    /**
     * The widget name.
     * @private
     * @static
     */
    WidgetName = "OCRPanel",

    /**
     * The internal table of OCRPanel instances.
     * @private
     * @static
     */
    instances = {},

    /**
     * The manager for OCRPanel instances.
     * @private
     * @static
     */
    manager = new YAHOO.widget.OverlayManager(),

    /**
     * A click counter to record the number of clicks on the panel.
     * @private
     * @static
     */
    OCR_CLICK_COUNTER = 0,

    /**
     * A click counter to record the number of marker clicks.
     * @private
     * @static
     */
    MARKER_CLICK_COUNTER = 0,

    /*
     * Configuration details.
     */

    /**
    * Constant representing the OCRPanel's configuration properties
    * @property DEFAULT_CONFIG
    * @private
    * @final
    * @type Object
    */

    DEFAULT_CONFIG = {
        "HEADER_COLOR": { 
            key: "header_color", 
            value: "#224477",
            validator: Lang.isString, 
            supercedes: ["iframe", "visible"] 
        },
        "CENTER": { 
            key: "center",
            validator: Lang.isString, 
            supercedes: ["iframe", "visible"] 
        },
        "ZOOM": { 
            key: "zoom",
            value: 10,
            validator: Lang.isNumber, 
            supercedes: ["iframe", "visible", "center"] 
        },
        "CRIME": { 
            key: "crime",
            value: false,
            validator: Lang.isString, 
            supercedes: ["iframe", "visible"] 
        },
/*******
        "TRAFFIC": { 
            key: "traffic",
            value: false,
            validator: Lang.isBoolean, 
            supercedes: ["iframe", "visible"] 
        },
        "REALESTATE": { 
            key: "realestate",
            value: false,
            validator: Lang.isString, 
            supercedes: ["iframe", "visible"] 
        },
        "RESTAURANTS": { 
            key: "restaurants",
            value: false,
            validator: Lang.isString, 
            supercedes: ["iframe", "visible"] 
        },
        "TALK": { 
            key: "talk",
            value: 0,
            validator: Lang.isString, 
            supercedes: ["iframe", "visible"] 
        },
        "MORE": { 
            key: "more",
            value: false,
            validator: Lang.isBoolean, 
            supercedes: ["iframe", "visible"] 
        },
*********/
        "FOOTER_MESSAGE": { 
            key: "footer_message",
            value: "",
            validator: Lang.isString, 
            supercedes: ["iframe", "visible"] 
        },
        "TYPE": { 
            key: "type",
            validator: Lang.isString, 
            supercedes: ["iframe", "visible"] 
        },
        "CONTENT": { 
            key: "content",
            validator: Lang.isString,
            supercedes: ["iframe", "visible"] 
        },
        "SRC": { 
            key: "src",
            validator: Lang.isString, 
            supercedes: ["iframe", "visible"] 
        },
        "LAYERS": { 
            key: "layers",
            validator: Lang.isArray, 
            supercedes: ["iframe", "visible", "footer_message"] 
        }
    },
        

    /*
     * Internationalizable strings in the ResizePanel component
     */

    STRINGS = {
        "HEADER_TOOLTIP_MESSAGE": 'You can drag this panel and resize it with the buttons in the upper-right corner and the handle on the bottom-right corner'
    };

    /**
    * Constant representing the default CSS class used for a ResizePanel
    * @property YAHOO.widget.Panel.CSS_PANEL_RESIZE
    * @static
    * @final
    * @type String
    */
    OCRPanel.CSS_PANEL_RESIZE = "ocr-resizepanel";

    /**
    * Constant representing the default CSS class used for an options panel.
    * @property OCRPanel.CSS_PANEL_OPTIONS
    * @static
    * @final
    * @type String
    */
    OCRPanel.CSS_PANEL_OPTIONS = "ocr-optionspanel";

    /*
     * Private helper functions used by the ResizePanel component
     */

    /**
     * Log user interactions with the panel.
     * @method clickLog
     * @private
     */
    function clickLog(type) {
        var img = new Image();
        var date = new Date();
        var base_url = "http://www.ocnewsmap.com/img/dot_clear.gif?uncache=" + date.getTime() + "&";

        switch(type.toLowerCase()) {
        case "load":
            Event.addListener(this.el, "click", function() { OCR_CLICK_COUNTER += 1; });
            img.src = base_url + "type=load&page=" + document.URL;
            break;
        case "unload":
            img.src = base_url + "type=unload&cc=" + OCR_CLICK_COUNTER + "&mc=" + MARKER_CLICK_COUNTER + "&page=" + document.URL;
            break;
        case "fullsize":
            img.src = base_url + "type=fullsize&page=" + document.URL;
            break;
        case "expand":
            img.src = base_url + "type=expand&page=" + document.URL;
            break;
        case "shrink":
            img.src = base_url + "type=shrink&page=" + document.URL;
            break;
        case "close": 
            img.src = base_url + "type=close&page=" + document.URL;
            break;
        case "resize":
            img.src = base_url + "type=resize&page=" + document.URL;
            break;
        case "ocsd crime calls":
            img.src = base_url + "type=crime&page=" + document.URL;
            break;
        case "real estate":
            img.src = base_url + "type=realestate&page=" + document.URL;
            break;
        case "restaurant violations":
            img.src = base_url + "type=restaurants&page=" + document.URL;
            break;
        case "talk":
            img.src = base_url + "type=talk&page=" + document.URL;
            break;
        case "live traffic":
            img.src = base_url + "type=traffic&page=" + document.URL;
            break;
        case "traffic video": 
            img.src = base_url + "type=traffic_video&page=" + document.URL;
            break;
        case "driving directions": 
            img.src = base_url + "type=directions&page=" + document.URL;
            break;
        case "wikipedia": 
            img.src = base_url + "type=wiki&page=" + document.URL;
            break;
        case "photos": 
            img.src = base_url + "type=panoramio&page=" + document.URL;
            break;
        }
    }

    /*
     * Static members and methods of the ResizePanel component
     */

    /**
     * Return the appropriate OCRPanel object based on the id associated with
     * the ResizePanel element or false if none match.
     * @method getById
     * @public
     * @static
     */
    OCRPanel.getById = function (id) {
        return instances[id] ? instances[id] : false;
    };

YAHOO.extend(OCRPanel, Panel, {

        /*
         * Internal variables used within the ResizePanel component
         */

        /**
         * The OCRPanel buttons.
         *
         * @property _Btns
         * @private
         */
         //not used right now
        _Btns: null,

        /*
         * Public methods of the OCRPanel component
         */
      
        /**
        * The Overlay initialization method, which is executed for Overlay and 
        * all of its subclasses. This method is automatically called by the 
        * constructor, and  sets up all DOM references for pre-existing markup, 
        * and creates required markup if it is not already present.
        * @method init
        * @param {String} el The element ID representing the Overlay <em>OR</em>
        * @param {HTMLElement} el The element representing the Overlay
        * @param {Object} userConfig The configuration object literal 
        * containing the configuration that should be set for this Overlay. 
        * See configuration documentation for more details.
        */

        init: function(el, userConfig) {

            /*
                 Note that we don't pass the user config in here yet because 
                 we only want it executed once, at the lowest subclass level
            */

            OCRPanel.superclass.init.call(this, el/*, userConfig*/);
            this.userConfig = userConfig;

            this.beforeInitEvent.fire(OCRPanel);

            Dom.addClass(document.getElementsByTagName("body")[0], " yui-skin-sam");
            Dom.addClass(this.innerElement, OCRPanel.CSS_PANEL_RESIZE);

            this.panelHomeEl = document.createElement("div");
                this.panelHomeEl.id = "panel-home-" + userConfig.id;
                this.element.parentNode.insertBefore(this.panelHomeEl, this.element);

            var footerMessageEl = this.footerMessageEl = document.createElement("div");
            footerMessageEl.innerHTML = "";
            Dom.addClass(footerMessageEl, "footer_message");

            var serviceMessageEl = this.serviceMessageEl = document.createElement("div");
            Dom.addClass(serviceMessageEl, "service_message");

            var layersEl = this.layersEl = document.createElement("div");
            Dom.addClass(layersEl, "footer_layers");

            this.setHeader("");
            this.setBody("");
            this.setFooter(layersEl);
            this.appendToFooter(footerMessageEl);
            this.appendToFooter(serviceMessageEl);

         //   var headerTooltip = 
            new YAHOO.widget.Tooltip("headerTooltip" + userConfig.id, {
                context:this.header,
                zIndex:502,
                text:STRINGS.HEADER_TOOLTIP_MESSAGE } );

            instances[userConfig.id] = this;

            var resize = this.resize = new YAHOO.util.Resize(el, {
                handles: ["br"],
                autoRatio: false,
                minWidth: 100,
                minHeight: 100,
                proxy: true, 
                status:  false 
            });

            // Setup resize handler to update the Panel's 'height' configuration property 
            // whenever the size of the 'resizablepanel' DIV changes.

            // Setting the height configuration property will result in the 
            // body of the Panel being resized to fill the new height (based on the
            // autofillheight property introduced in 2.6.0) and the iframe shim and 
            // shadow being resized also if required (for IE6 and IE7 quirks mode).
            resize.on("resize", this.doResize, this, true);
            resize.on("resize", function() {clickLog("resize"); }, this, true);

            resize.on("startResize", function(/*args*/) {
                var clientRegion = Dom.getClientRegion();
                var elRegion = Dom.getRegion(this.element);
                resize.set("maxWidth", clientRegion.right - elRegion.left - YAHOO.widget.Overlay.VIEWPORT_OFFSET);
                resize.set("maxHeight", clientRegion.bottom - elRegion.top - YAHOO.widget.Overlay.VIEWPORT_OFFSET);
            }, this, true);

            this._initResizeButtons();

            if(userConfig) {
                if(userConfig.content.substring(0,3) === "map") {
                    this._initMap();
     //               this.geocoder = new GClientGeocoder();
                    this.geocoder = new google.maps.Geocoder();
                    this.cluster_mgr = new ClusterManager(this.map);
                    this.cluster_mgr.show();
//                    var mapControl = new TrafficControl("Traffic", this);
                    var mapMoreControl = new MoreControl("More...", "More map options");
                    this.mapMoreControl = mapMoreControl;
                    mapMoreControl.initialize();
                    mapMoreControl.index = 1;
                    this.map.controls[google.maps.ControlPosition.RIGHT_TOP].push(mapMoreControl.controlDiv);
                    this.crimeControl = new CrimeControl(mapMoreControl, this);
//                    this.realEstateControl = new RealEstateControl(mapMoreControl, this);
//                    this.restaurantControl = new RestaurantControl(mapMoreControl, this);
//                    this.trafficControl = new TrafficControl(mapMoreControl, this);
//                    this.videoControl = new VideoControl(mapMoreControl, this.map);
//                    this.drivingDirectionsControl = new DrivingDirectionsControl(mapMoreControl, this.map);
//                    this.wikiLayer = new GLayer("org.wikipedia.en");
//                    mapMoreControl.addMoreItem("Wikipedia",
//                                                 {click:function() { me.map.addOverlay(me.wikiLayer);},
//                                                  unclick:function() {me.map.removeOverlay(me.wikiLayer);}});
//                    this.panoramioLayer = new GLayer("com.panoramio.all");
//                    mapMoreControl.addMoreItem("Photos",
//                                                 {click:function() { me.map.addOverlay(me.panoramioLayer);},
//                                                  unclick:function() {me.map.removeOverlay(me.panoramioLayer);}});
                }
                this.cfg.applyConfig(userConfig, true);
//                this.map.addControl(mapMoreControl, new GControlPosition(G_ANCHOR_TOP_RIGHT, new GSize(8, 29)));
//                mapMoreControl.container.style.zIndex = 1000;
            }
        },

        /**
         * Initializes the panel's resize buttons.
         * @method initResizeButtons
         */

        _initResizeButtons: function () {
            var me=this;
            var expandEl = this.expandEl = document.createElement("span");
                Dom.addClass(expandEl, "mmi_expand");
            var shrinkEl = this.shrinkEl = document.createElement("span");
                Dom.addClass(shrinkEl, "mmi_shrink");
            var fullScreenEl = this.fullScreenEl = document.createElement("span");
                Dom.addClass(fullScreenEl, "mmi_fullscreen");
            var panelCloseEl = this.panelCloseEl = document.createElement("span");
                Dom.addClass(panelCloseEl, "mmi_panel_close");
            Dom.addClass([expandEl, shrinkEl, fullScreenEl, panelCloseEl], "mmi_panel-button");
            this.setHeader(expandEl);
            this.appendToHeader(shrinkEl);
            this.appendToHeader(fullScreenEl);
            this.appendToHeader(panelCloseEl);

        //    var currentWidth = parseInt(this.cfg.getProperty("width")),
        //        currentHeight = parseInt(this.cfg.getProperty("height"));

            Event.on(expandEl, "click", this.doExpand, this, true);
            Event.on(shrinkEl, "click", this.doShrink, this, true);
            Event.on(fullScreenEl, "click", this.doFullScreen, this, true);
            Event.on(panelCloseEl, "click", function() {me.doClose(); me.doClose();}, this, true); //ie likes this to run twice or the underlay doesn't resize.
        },

        _initMap: function() {
            var mapEl = this.mapEl = document.createElement("div"); 
            Dom.setStyle(mapEl, "height", "100%");
            Dom.setStyle(mapEl, "width", "100%");
            Dom.addClass(mapEl, "ocr-resize-map");
            var mapOptions = { zoom                     : 13,
                               center                   : new google.maps.LatLng(33.75105, -117.85046),
                               mapTypeControlOptions    : {style: google.maps.MapTypeControlStyle.DEFAULT},
                               navigationControl        : true,
                               navigationControlOptions : {style: google.maps.NavigationControlStyle.DEFAULT},
                               googleBarOptions         : {suppressZoomToBounds: true, showOnLoad: true} };
            this.map = new google.maps.Map(mapEl, mapOptions);
   
/***
            this.smallMapTypeControl = new GMapTypeControl(true);
            this.largeMapTypeControl = new GMapTypeControl();
            this.smallMapControl = new GSmallZoomControl3D();
            this.largeMapControl = new GLargeMapControl3D();
            this.smallHierMapControl = new GHierarchicalMapTypeControl(true);
            this.largeHierMapControl = new GHierarchicalMapTypeControl();
            this.overviewMapControl = new GOverviewMapControl();
            this.geocoder = new GClientGeocoder();
            map.addMapType(G_PHYSICAL_MAP);
            map.addMapType(G_SATELLITE_3D_MAP);
            this.smallHierMapControl.clearRelationships();
            this.smallHierMapControl.addRelationship(G_SATELLITE_MAP, G_HYBRID_MAP, "Labels", false);
            this.largeHierMapControl.clearRelationships();
            this.largeHierMapControl.addRelationship(G_SATELLITE_MAP, G_HYBRID_MAP, "Labels", false);
            
            map.setCenter(new GLatLng(33.75105, -117.85046), 13); //map doesn't init right if we don't add it to the DOM with a center.
***/
            this.appendToBody(mapEl);

            //This is a listener that checks to make sure infowindows that have images are sized 580px wide and at least 400px tall.
/*******
            google.maps.event.(map, "infowindowopen", function() { 
                    var iw = document.getElementById("iw_kml");
                    if(!iw) return;
                    var title = iw.parentNode.firstChild;
                    var imgs = iw.getElementsByTagName("img");
                    if(imgs.length > 0) {
                        var iw_new = document.createElement("div");
                        var iw_new_body = document.createElement("div");
                        if(title.innerHTML !== iw_new_body.innerHTML && title.id !== "iw_kml") {
                            iw_new_body.innerHTML += '<div style="font-weight: bold; font-size: medium; margin-bottom: 0em;">'
                                                  + title.innerHTML + '</div>';
                        }
                        iw_new_body.innerHTML += iw.innerHTML + "";
                        iw_new.appendChild(iw_new_body);
                        Dom.setStyle(iw_new, "width", "580px");
                        Dom.setStyle(iw_new, "height", 400 * imgs.length + "px");
                        map.updateInfoWindow([new GInfoWindowTab("", iw_new)]);
                    }
                } );
********/

        },
        showServiceMessage: function(message) {
            Dom.setStyle(this.footerMessageEl, "display", "none");
            this.serviceMessageEl.innerHTML = message;
            Dom.setStyle(this.serviceMessageEl, "display", "block");
        },

        hideServiceMessage: function() {
            Dom.setStyle(this.serviceMessageEl, "display", "none");
            Dom.setStyle(this.footerMessageEl, "display", "block");
            this.serviceMessageEl.innerHTML = "";
        },

        doResize: function(args) {
            var panelHeight = parseInt(args.height),
                panelWidth = parseInt(args.width);
            this.cfg.setProperty("height", panelHeight + "px");
            this.cfg.setProperty("width", panelWidth + "px");
        },
        doExpand: function () {
            this.cfg.setProperty("height", parseInt(this.cfg.getProperty("height")) + 300 + "px"); 
            this.cfg.setProperty("width", parseInt(this.cfg.getProperty("width")) + 300 + "px");
            clickLog("expand");
        },
        doShrink: function () {
            this.cfg.setProperty("height", parseInt(this.cfg.getProperty("height")) - 300 + "px"); 
            this.cfg.setProperty("width", parseInt(this.cfg.getProperty("width")) - 300 + "px");
            clickLog("shrink");
        },
        doFullScreen: function () {
            //var panelContext = ["mmi_more_control","tr","br"];
            this.cfg.setProperty("height", Dom.getViewportHeight() - 12 + "px"); 
            this.cfg.setProperty("width", Dom.getViewportWidth() - 10 + "px");
            this.cfg.setProperty("draggable", false);
            this.cfg.setProperty("fixedcenter", true); 
            var handles = Dom.getElementsByClassName("yui-resize-handle");
            for(var i=0, handle; handle = handles[i]; i++) {
                Dom.setStyle(handle, "visibility", "hidden");
            }
            this.expandEl.style.display = this.shrinkEl.style.display = this.fullScreenEl.style.display = "none";
            this.shrinkEl.style.display = "none";
            var body = document.getElementsByTagName("body")[0];
            body.style.visibility = "hidden";
            Event.removeListener(window, "resize", this.doFullScreen);
            Event.on(window, "resize", this.doFullScreen, this, true);
            clickLog("fullsize");
        },
        doClose: function () {
            //var panelContext = ["mmi_more_control","tl","bl"];
            this.fullScreenEl.style.display = "block";
            this.cfg.setProperty("height", this.userConfig.height); 
            this.cfg.setProperty("width", this.userConfig.width);
            this.cfg.setProperty("draggable", true);
            this.cfg.setProperty("fixedcenter", false); 
            var handles = Dom.getElementsByClassName("yui-resize-handle");
            for(var i=0, handle; handle = handles[i]; i++) {
                Dom.setStyle(handle, "visibility", "visible");
            }
            var body = document.getElementsByTagName("body")[0];
            body.style.visibility = "visible";
            var anim = new Motion(this.element, { points: { to: Dom.getXY(this.panelHomeEl) } }, 0.3);
            anim.animate();
            Event.removeListener(window, "resize", this._fullScreenListener);
            clickLog("close");
        },
        _checkResize: function() {
            if(!this.checkSizeCount) this.checkSizeCount = 1;
            if(this.checkSizeCount > 2 && parseInt(this.cfg.getProperty("height")) > 500 && parseInt(this.cfg.getProperty("width")) > 590) {
                this.shrinkEl.style.display = "block";
                this.expandEl.style.display = "none";
            } else {
                this.shrinkEl.style.display = "none";
                this.expandEl.style.display = "block";
            }
            this.checkSizeCount++; //So we only get expand buttons when the map is first loaded.
            if(this.map) {
                var map = this.map;
//	        map.removeControl(this.smallMapControl);
//	        map.removeControl(this.largeMapControl);
                if(parseInt(this.cfg.getProperty("height")) >= 350 && parseInt(this.cfg.getProperty("width")) >= 350) {
//                    map.removeControl(this.smallHierMapControl);
//                    map.addControl(this.largeHierMapControl);
//                    map.addControl(this.largeMapControl);
                    if(!UA.ie) {
//                        map.enableGoogleBar();
                    }
                } else {
//                    map.removeControl(this.largeHierMapControl);
//                    map.addControl(this.smallHierMapControl);
//                    map.addControl(this.smallMapControl);
//                    map.disableGoogleBar();
                }
                var center = map.getCenter();
                google.maps.event.trigger(map, "resize");
                if(center) {
                    map.setCenter(center);
                }
            }
        },

        /**
         * Initializes the class's configurable properties which can be changed 
         * using the OCRPanel's Config object (cfg).
         * @method initDefaultConfig
         */

        initDefaultConfig: function () {
            OCRPanel.superclass.initDefaultConfig.call(this);

            var cfg = this.cfg;
 
            /**
            * CSS color of the Overlay header.
            * @config header_color
            * @type String
            * @default "#224477"
            */

            cfg.addProperty(DEFAULT_CONFIG.HEADER_COLOR.key, { 
                handler: this.configHeaderColor, 
                value: DEFAULT_CONFIG.HEADER_COLOR.value, 
                suppressEvent: DEFAULT_CONFIG.HEADER_COLOR.suppressEvent, 
                supercedes: DEFAULT_CONFIG.HEADER_COLOR.supercedes
            });

            /**
            * Zoom level of the map.
            * @config zoom
            * @type Number
            * @default 10
            */

            cfg.addProperty(DEFAULT_CONFIG.ZOOM.key, {
                handler: this.configZoom, 
                value: DEFAULT_CONFIG.ZOOM.value, 
                suppressEvent: DEFAULT_CONFIG.ZOOM.suppressEvent, 
                supercedes: DEFAULT_CONFIG.ZOOM.supercedes
            });

            /**
            * Center point of the map.
            * @config center
            * @type String representing a floating point tuple.
            * @default null
            */

            cfg.addProperty(DEFAULT_CONFIG.CENTER.key, {
                handler: this.configCenter, 
                suppressEvent: DEFAULT_CONFIG.CENTER.suppressEvent, 
                supercedes: DEFAULT_CONFIG.CENTER.supercedes
            });

            /**
            * Turn crime on or off initially.
            * @config crime
            * @type {String|Boolean} Names of cities separated by commas.
            * @default false
            */

            cfg.addProperty(DEFAULT_CONFIG.CRIME.key, {
                handler: this.configCrime, 
                value: DEFAULT_CONFIG.CRIME.value, 
                suppressEvent: DEFAULT_CONFIG.CRIME.suppressEvent, 
                supercedes: DEFAULT_CONFIG.CRIME.supercedes
            });
/**********
            **
            * Turn real estate on or off initially.
            * @config realestate
            * @type Boolean
            * @default false
            *

            cfg.addProperty(DEFAULT_CONFIG.REALESTATE.key, {
                handler: this.configRealEstate, 
                value: DEFAULT_CONFIG.REALESTATE.value, 
                suppressEvent: DEFAULT_CONFIG.REALESTATE.suppressEvent, 
                supercedes: DEFAULT_CONFIG.REALESTATE.supercedes
            });

            **
            * Turn restaurants on or off initially.
            * @config restaurants
            * @type Boolean.
            * @default false
            *

            cfg.addProperty(DEFAULT_CONFIG.RESTAURANTS.key, {
                handler: this.configRestaurants, 
                value: DEFAULT_CONFIG.RESTAURANTS.value, 
                suppressEvent: DEFAULT_CONFIG.RESTAURANTS.suppressEvent, 
                supercedes: DEFAULT_CONFIG.RESTAURANTS.supercedes
            });

            **
            * Turn talk on or off initially.
            * @config talk
            * @type Number.
            * @default 0
            *

            cfg.addProperty(DEFAULT_CONFIG.TALK.key, {
                handler: this.configTalk, 
                value: DEFAULT_CONFIG.TALK.value, 
                suppressEvent: DEFAULT_CONFIG.TALK.suppressEvent, 
                supercedes: DEFAULT_CONFIG.TALK.supercedes
            });

            **
            * Set whether More Button is expanded when the map loads
            * @config more
            * @type Boolean.
            * @default false
            *

            cfg.addProperty(DEFAULT_CONFIG.MORE.key, {
                handler: this.configExpandedMore, 
                value: DEFAULT_CONFIG.MORE.value, 
                suppressEvent: DEFAULT_CONFIG.MORE.suppressEvent, 
                supercedes: DEFAULT_CONFIG.MORE.supercedes
            });

            **
            * Turn traffic on or off initially.
            * @config traffic
            * @type Boolean.
            * @default false
            *

            cfg.addProperty(DEFAULT_CONFIG.TRAFFIC.key, {
                handler: this.configTraffic, 
                value: DEFAULT_CONFIG.TRAFFIC.value, 
                suppressEvent: DEFAULT_CONFIG.TRAFFIC.suppressEvent, 
                supercedes: DEFAULT_CONFIG.TRAFFIC.supercedes
            });
**********/
            /**
            * Set the message to display in the footer.
            * @config footer_message
            * @type String.
            * @default ""
            */

            cfg.addProperty(DEFAULT_CONFIG.FOOTER_MESSAGE.key, {
                handler: this.configFooterMessage, 
                value: DEFAULT_CONFIG.FOOTER_MESSAGE.value, 
                suppressEvent: DEFAULT_CONFIG.FOOTER_MESSAGE.suppressEvent, 
                supercedes: DEFAULT_CONFIG.FOOTER_MESSAGE.supercedes
            });

            /**
            * Content type of the src (kml, georss, json, gif, jpg, png, etc). Not really used right now.
            * @config type
            * @type string.
            * @default null
            */

            cfg.addProperty(DEFAULT_CONFIG.TYPE.key, {
                handler: this.configType, 
                suppressEvent: DEFAULT_CONFIG.TYPE.suppressEvent, 
                supercedes: DEFAULT_CONFIG.TYPE.supercedes
            });

            /**
            * Content type of the src (map/satellite, map/terrain, map/normal or img).
            * @config content
            * @type String
            * @default null
            */

            cfg.addProperty(DEFAULT_CONFIG.CONTENT.key, {
                handler: this.configContent, 
                suppressEvent: DEFAULT_CONFIG.CONTENT.suppressEvent, 
                supercedes: DEFAULT_CONFIG.CONTENT.supercedes
            });

            /**
            * SRC value of the data file.
            * @config src
            * @type String
            * @default null
            */

            cfg.addProperty(DEFAULT_CONFIG.SRC.key, {
                handler: this.configSRC, 
                suppressEvent: DEFAULT_CONFIG.SRC.suppressEvent, 
                supercedes: DEFAULT_CONFIG.SRC.supercedes
            });

            /**
            * SRC values for map layers. 
            * @config layers
            * @type String
            * @default null
            */

            cfg.addProperty(DEFAULT_CONFIG.LAYERS.key, {
                handler: this.configLayers, 
                suppressEvent: DEFAULT_CONFIG.LAYERS.suppressEvent, 
                supercedes: DEFAULT_CONFIG.LAYERS.supercedes
            });
        },

        configHeaderColor: function(type, args /*, obj*/) {
            var color = args[0],
                el = this.header;
            Dom.setStyle(el, "backgroundColor", color);
            if(window.location.hostname === "www.orangecounty.com") {
                Dom.setStyle(el, "backgroundColor", "#540000");
                Dom.setStyle(el, "backgroundImage", "url(http://www2.ocregister.com/api/img/ocr-panel/panel_logo_oc.png)");
            }
        },

        configZoom: function(type, args /*, obj*/) {
            this.zoomLevel = parseInt(args[0]);
        },

        configCenter: function(type, args /*, obj*/) {
            var latLng    = args[0].split(","),
                zoomLevel = parseInt(this.cfg.getProperty("zoom")),
                mapCenter = new google.maps.LatLng(latLng[0], latLng[1]);
//                mapCenter = new GLatLng(latLng[0], latLng[1]);
            this.map.setCenter(mapCenter);
            this.map.setZoom(zoomLevel);
//            this.map.setCenter(mapCenter, zoomLevel);
        },

        configCrime: function(type, args /*, obj*/) {
            var me=this,
                crimeInput = args[0],
                pageHoleIncrease;
            if(crimeInput && crimeInput !== "false") {
                var contextWidth = parseInt(this.userConfig.width);
                var panelWidth = (contextWidth >= 480 && contextWidth <= 700) ? contextWidth+"px":"500px";
                var panel = this.crimeControl.buildPanel(this.crimeControl,  {"context": [this.id + "_c", "tl", "bl", [], [0, 0]]});
                panel.cfg.setProperty("width", panelWidth);
                panel.element.style.visibility = "visible";
                this.crimeControl.checkbox.checked = true;
                this.mapMoreControl.increaseCount();
                if(UA.ie > 5) {
                    pageHoleIncrease = 395;
                } else {
                    pageHoleIncrease = 365;
                }
                Event.onDOMReady(function() {
                                     me.userConfig.pageHole.style.height = parseInt(me.userConfig.pageHole.style.height) + pageHoleIncrease + "px";
                                     });
                if(crimeInput === "true") {
                    this.crimeControl.moveEnd();
                } else {
                    this.crimeControl.getIncidents(crimeInput);
                }
                function onBeforeHide() {me.userConfig.pageHole.style.height = parseInt(me.userConfig.pageHole.style.height) - pageHoleIncrease + "px";
                                         panel.unsubscribe("beforeHide", onBeforeHide);}
                panel.subscribe("beforeHide", onBeforeHide);
  //TODO              panel.subscribe("hide", function() { me.crimeControl.panel.cfg.setProperty("context", panelContext);});
            }
        },
/**********
        configRestaurants: function(type, args, ojb) {
            var restaurantInput = args[0];
            if(restaurantInput || restaurantInput === "true") {
                this.restaurantControl.checkbox.checked = true;
                this.mapMoreControl.increaseCount();
                this.restaurantControl.show();
            }
        },

        configRealEstate: function(type, args, ojb) {
            var realEstateInput = args[0];
            if(realEstateInput && realEstateInput !== "false") {
                this.realEstateControl.checkbox.checked = true;
                this.mapMoreControl.increaseCount();
                this.realEstateControl.show();
            }
        },

        configTalk: function(type, args, ojb) {
            var me = this;
            var talkInput = args[0];
            if(!talkInput) return;
            talkInput = talkInput.split(",");
            var talkTopic = (typeof talkInput[0] !== "undefined") ? talkInput[0]:(window.location.href.match(/\d{6,6}/) || "000000");
            var talkDuration = (typeof talkInput[2] === "undefined" || talkInput[2] === "true")? "true":parseInt(talkInput[0]);

            if(talkDuration > 0 || talkDuration === "true") {
                ZOOMISH = {};
                ZOOMISH.config = { map_name   : talkTopic, 
                                   map        : me.map, 
                                   map_button : true, 
                                   moderated  : true,
                                   talk_opts  : {visible: false, left: 85, top: 29}};
                if(typeof talkInput[1] !== "undefined") ZOOMISH.config.default_icon = talkInput[1];
//                Get.script("http://media.zoomish.com/js/zoomish-min.js", {onSuccess: function() {ZOOMISH.loader();}});
//, {onSuccess: function() {ZOOMISH.init();}}
//function() {();}
                Get.script("http://www.ocnewsmap.com/zoomish/js/zoomish-with-loader.js", {onSuccess: function() {ZOOMISH.loader();} });
            }
        },
        configExpandedMore: function(type, args, ojb) {
            var expandedInput = args[0];
            if(expandedInput) {
                var moreEl = document.getElementById("mmi_more_control_mouseover");
                moreEl.style.display = "block";
            }
        },
        configTraffic: function(type, args, ojb) {
            var me=this;
            var trafficInput = args[0];
            if(trafficInput == "true") {
                var contextWidth = parseInt(this.userConfig.width);
                var panelWidth = (contextWidth >= 200 && contextWidth <= 700) ? contextWidth+"px":"230px";
                var panel = this.trafficControl.buildPanel(this.trafficControl,  {"context": [this.id + "_c", "tl", "bl", [], [0, 0]]});
                var trafficCalendarEl = document.getElementById("MMI_traffic_calendar_el");
                var trafficExplainerEl = document.getElementById("MMI_traffic_explainer_el");
                var trafficSelectEl = document.getElementById("MMI_traffic_calendar_select_el");
                var trafficKey = document.getElementById("MMI_traffic_key");
                var pageHoleIncrease = 305;
                panel.cfg.setProperty("width", panelWidth);
                this.trafficControl.checkbox.checked = true;
                this.mapMoreControl.increaseCount();
                if(contextWidth <= 415) {
                    trafficCalendarEl.style.display = "none";
                    trafficExplainerEl.style.display = "none";
//                    trafficSelectEl.sytle.display = "none";
                    panel.cfg.setProperty("height", "250px");
                    pageHoleIncrease = 250;
                }
                panel.element.style.visibility = "visible";
                Event.onDOMReady(function() {
                                     me.trafficControl.show();
                                     me.userConfig.pageHole.style.height = parseInt(me.userConfig.pageHole.style.height) + pageHoleIncrease + "px";
                                     });
                function onBeforeHide() {me.userConfig.pageHole.style.height = parseInt(me.userConfig.pageHole.style.height) - pageHoleIncrease + "px";
                                         panel.unsubscribe("beforeHide", onBeforeHide);}
                panel.subscribe("beforeHide", onBeforeHide);
                panel.subscribe("hide", function() { panel.cfg.setProperty("context", panelContext); 
                                                     trafficCalendarEl.style.display = "block"; 
                                                     trafficExplainerEl.style.display = "block";
   //                                                  trafficSelectEl.sytle.display = "block";
                                                     panel.cfg.setProperty("height", "305px");
                                                     panel.cfg.setProperty("width", "460px");});
            }
        },
*******/
        configFooterMessage: function(type, args /*, obj*/) {
            var footerMessage = args[0];
            if(footerMessage) {
                this.footerMessageEl.innerHTML = footerMessage;
            }
            this.doResize({height: this.cfg.getProperty("height"), width: this.cfg.getProperty("width")});
        },
    
        /*
        configType: function(type, args, obj) {
        },
        */
    
        configContent: function(type, args /*, obj*/) {
            if(args[0].substring(0, 3) === "map") {
                //type is a string that will be either image/type or map/type.
                var mapType = google.maps.MapTypeId.ROADMAP;
                if (args[0].substring(4,14) === "satellite") {
                    mapType = google.maps.MapTypeId.SATELLITE;
                } else if (args[0].substring(4,12) === "terrain") {
                    mapType = google.maps.MapTypeId.TERRAIN;
                } else if (args[0].substring(4,12) === "hybrid") {
                    mapType = google.maps.MapTypeId.HYBRID;
                }
                this.map.setMapTypeId(mapType);
            }
        },

        configSRC: function(type, args /*, obj*/) {
              var geoSrc = this.geoSrc = new google.maps.KmlLayer(args[0]);
              geoSrc.setMap(this.map);
        },

        configLayers: function(type, args /*, obj*/) {
            if (args && args[0] === null) return;
            var me=this,
         //       content = "",
                contentContainer = document.createElement("span"),
                layers = args[0],
                height = args[0].length * 23 + 21;

            this.layers = layers;
            
            if(this.layersContainer) {
                this.layersEl.removeChild(this.layersContainer);   
            } 
            this.layersContainer = contentContainer;

            if(this.cfg.getProperty("footer_message") !== "") {
                height += 13;
            }

            var layersTitle = document.createElement("div");
            layersTitle.innerHTML = "<b>Layers</b>";
            layersTitle.id = "MMI_layers_title";
            contentContainer.appendChild(layersTitle);

            this.loadingCount = 0;

              var geoSrc = this.geoSrc = new google.maps.KmlLayer(args[0]);
              geoSrc.setMap(this.map);
            function createLayerCheckbox(opts) {
                var geoSrc = new google.maps.KmlLayer(opts.src),
                    el     = document.createElement("span"),
                    span   = document.createElement("span"),
                    input  = document.createElement("input"),
                    layer  = {};
                google.maps.event.addListener(geoSrc, 'status_changed', function () {
                                 me.loadingCount -= 1;
          //                       if(me.loadingCount === 0) me.hideLoading();
                });
                /*
                    geoXml = new GGeoXml(opts.src, function() {
                                 me.loadingCount -= 1;
                                 if(me.loadingCount === 0) me.hideLoading();
                             });
                */
                if(opts.on) { 
                    geoSrc.setMap(this.map);
              //      me.map.addOverlay(geoXml);
                }
                span.innerHTML = opts.text + "<br>";
                Dom.setStyle(span, "fontSize", "13px");
                if(!UA.ie) {
                    Dom.setStyle(input, "margin", "1px 5px 5px 5px");
                } 

                input.checked = opts.on;
                input.defaultChecked = opts.on;

                if(typeof opts.type === "undefined" || opts.type === "checkbox") {
                    input.type = "checkbox";
                    input.onclick = function() {
                            if(input.checked) {
                                geoSrc.setMap(me.map);
                                input.checked = true;
                            } else {
                                geoSrc.setMap(null);
                            }
                        };
                } else if(opts.type === "radio") {
                    input.type = "radio";
                    input.onclick = function() {
                            for(var j=0,item; item=layers[j]; j++) {
                                item.input.checked = false;
                    //TODO            me.map.removeOverlay(item.geoXml);
                            }
                      //TODO      me.map.addOverlay(geoXml);
                     //TODO       geoXml.show();
                            input.checked = true;
                    };
                }
                el.appendChild(input);
                if(typeof(opts.img) !== "undefined" && opts.img !== "") {
                    var img = document.createElement("img");
                    img.style.height = "20px";
                    img.style.paddingRight = "5px";
                    img.src = opts.img;
                    el.appendChild(img);
                }
                el.appendChild(span);
                layer.el = el;
                layer.input = input;
                layer.geoSrc = geoSrc;
                return layer;
            }
            for(var i=0,layer; layer=layers[i]; i++) {
                if(layer.nocheckbox) {
                    geoSrc = new google.maps.KmlLayer(layer.src);
                    height -= 20;
                } else {
                    layer = createLayerCheckbox(layer);
                    contentContainer.appendChild(layer.el);
                    layers[i] = layer;
                }
            }
            if(height === 24 || height === 37) return;  //no checkboxes, so don't add the layers container.
            Dom.setStyle(this.footer, "height", height + "px");
            this.layersEl.appendChild(contentContainer);
            this.layersEl.style.display = "block";

            this.doResize({height: this.cfg.getProperty("height"), width: this.cfg.getProperty("width")});
        },
        configHeight: function (/*type, args, obj*/) {
            OCRPanel.superclass.configHeight.apply(this, arguments);
            //this is really ugly but I can't figure out a better way to get the proper body height.
//            this._checkResize();
//            OCRPanel.superclass.configUnderlay.apply(this, arguments);  // this seems to help IE
        },
        configWidth: function (/*type, args, obj*/) {
            OCRPanel.superclass.configWidth.apply(this, arguments);
            this._checkResize();
//            OCRPanel.superclass.configUnderlay.apply(this, arguments);
        },
        showLoading: function (text) {
            if(!this.loadingDiv) {
                this._buildLoadingIndicator();
            }
            if(typeof text !== "undefined") {
                var messageEl = document.getElementById("mmi_loading_text");
                messageEl.innerHTML = text;
            }
            Dom.setStyle(this.loadingDiv, "top", parseInt(this.cfg.getProperty("height"))/2 - 25 + "px");
            Dom.setStyle(this.loadingDiv, "left", parseInt(this.cfg.getProperty("width"))/2 - 55 + "px");
            Dom.setStyle(this.loadingDiv, "display", "block");
        },
        hideLoading: function () {
            if(this.loadingDiv) Dom.setStyle(this.loadingDiv, "display", "none");
        },
        _buildLoadingIndicator: function() {
            var loadingDiv = this.loadingDiv = document.createElement("div");
              loadingDiv.style.position = "absolute";
              loadingDiv.style.zIndex = 1;
              loadingDiv.style.display = "none";
              loadingDiv.innerHTML = '<center><b style="font-size:175%"><span id="mmi_loading_text">Loading...</span><img src="/img/loading-circle-ball-transparent.gif"></b></center>';
            this.appendToBody(loadingDiv);
        },
        getCenterCity: function(city_map, callbackFn) {
  //          var mapCenter = this.map.getCenter();
            callbackFn("AVLN");
            return;
            /***
            this.geocoder.geocode(mapCenter, function(response) {
                console.log(response);
                return;
                                                 var area = null,
                                                     city1,
                                                     city2,
                                                     address_line;
                                                 for(var i=0, place; place=response.Placemark[i]; i++) {
                                                     try {
                                                         city1 = place.AddressDetails.Country.AdministrativeArea.Locality.LocalityName;
                                                         city2 = place.AddressDetails.Country.AdministrativeArea.SubAdministrativeArea.Locality.LocalityName;
                                                         address_line = place.AddressDetails.Country.AdministrativeArea.SubAdministrativeArea.AddressLine[0];
                                                         area = place.AddressDetails.Country.AdministrativeArea.SubAdministrativeArea.SubAdministrativeAreaName + " County";
                                                     } catch(err) {}
                                                     if(city1 in city_map) {
                                                         callbackFn(city_map[city1]);
                                                         return;     
                                                     }
                                                     if(city2 in city_map) {
                                                         callbackFn(city_map[city2]); 
                                                         return;    
                                                     }
                                                     if(address_line in city_map) {
                                                         callbackFn(city_map[address_line]); 
                                                         return;    
                                                     }
                                                 }
                                                 callbackFn(area);
                                              });
            ***/
        },
        /**
         * Return the string representation of the ResizePanel.
         *
         * @method toString
         * @public
         * @return {String}
         */
        toString: function () {
            return WidgetName + (this.get ? " (#" + this.get("id") + ")" : "");
        }

    });

/************************************************************************************
 * This is map control button stuff
 ************************************************************************************/
/************************************************************************************
 * Map Control base class
 ************************************************************************************/

var MapControl = function(name, title, opts) {
    if(!opts) opts = {};

    var me = this;
//        show = typeof opts.show !== "undefined" ? opts.show:false;

    this.name = name;
    this.title = typeof title !== "undefined" ? title:"";
    this.controlDiv = document.createElement("div");

    this.controlDivMouseover = this.buildMouseover();
 
    if(this.controlDivMouseover) {
        return; //assume the mouseover will create its own panels, so we're done.
    }

    opts.header = this.title;
    opts.body = this.buildPanel();
    opts.log = name;
    var panel = this.panel = createPanel(opts);

   /**
    * These are added so we can show the panel by clicking on the control div and hide it by clicking again
    * or clicking the close button.
    */
    function onBeforeShow() { 
        panel.innerElement.style.display="block";
        me.panel.focus();
        me.controlDiv.style.fontWeight = "bold";
        Event.purgeElement(me.controlDiv, false, "click");
        Event.addListener(me.controlDiv, "click", function() { me.panel.hide(); }, me);
        me.beforeShowEvent.fire(panel);
    }

    function onBeforeHide() {
        me.controlDiv.style.fontWeight = "normal";
        Event.purgeElement(me.controlDiv, false, "click");
        Event.addListener(me.controlDiv, "click", function() { me.panel.show(); }, me);
        me.beforeHideEvent.fire(panel);
    }

    panel.subscribe("beforeShow", onBeforeShow);
    panel.subscribe("beforeHide", onBeforeHide);
};

//MapControl.prototype = new GControl();

 /**
  * Creates a one DIV for the traffic button and places it in a container
  * DIV which is returned as our control element. We add the control to
  * to the map container and return the element for the map class to
  * position properly.
  */
MapControl.prototype.initialize = function(map) {
    var me = this;
    this.map = map;
    var container = this.container = document.createElement("div");
    var controlDiv = this.controlDiv;
    var controlDivName = this.controlDivName = document.createElement("span");
    controlDivName.innerHTML = this.name;

    this._setButtonStyle(controlDiv);

    container.appendChild(controlDiv);

    controlDiv.appendChild(controlDivName);

    if(this.controlDivMouseover) {
        var timer;
        function checkMouseLeave(element, evt) {
         /* Avoid firing a mouseout event
         *  when the mouse moves over a child element.
         *  Borrowed from:
         *  http://www.faqts.com/knowledge_base/view.phtml/aid/1606/fid/145
         */
         if(element.contains && evt.toElement) {
           return !element.contains(evt.toElement);
         }
         else if(evt.relatedTarget) {
           return !containsDOM(element, evt.relatedTarget);
         }
        }

        function containsDOM(container, containee) {
         var isParent = false;
         do {
          if((isParent = container === containee))
           break;
           containee = containee.parentNode;
         }
         while(containee != null);
          return isParent;
        }
        controlDiv.appendChild(this.controlDivMouseover);
        function showMouseover() {
            if(timer) clearTimeout(timer);
            me.controlDivMouseover.style.display = "block";
        }
        function hideMouseover(e) {
           if(!e) e = window.event;
           if(checkMouseLeave(me.controlDivMouseover, e)) timer = setTimeout(function() {me.controlDivMouseover.style.display = "none"; }, 600);
        }
        Event.addListener(controlDiv, "mouseover", showMouseover, this);
        Event.addListener(controlDiv, "mouseout", hideMouseover, this);
    }else {
        Event.addListener(controlDiv, "click", function() { me.panel.show(); }, this);
    }

//    map.getContainer().appendChild(container);
//    me.controlDivMouseover.style.display = "block";
    return container;
}; 

// Sets the proper CSS for the given button element.
MapControl.prototype._setButtonStyle = function(button) {
    var button_width = this.name.length * 6 + 30;
    Dom.addClass(button, "mmi_control_button");
    Dom.setStyle(button, "width", button_width + "px");
};

MapControl.prototype.buildMouseover = function() {
    return null;
};

MapControl.prototype.buildPanel = function() {
    return "";
};

var createPanel = function(opts) {
    var context = ["ocr-resize-panel1","tl","tl"];
    var panel = new Panel(Dom.generateId(undefined, "ocr-optionspanel"), { context:context,
                                                             width:"260px", 
                                                             visible:false, 
                                                             draggable:true, 
                                                             zIndex:501, 
                                                             underlay:"none", 
                                                             close:true, 
                                                             effect:[{effect:YAHOO.widget.ContainerEffect.SLIDE,duration:0.35},
                                                                     {effect:YAHOO.widget.ContainerEffect.FADE,duration:0.35}]} );
    Dom.addClass(panel.innerElement, OCRPanel.CSS_PANEL_OPTIONS);
    panel.cfg.applyConfig(opts);

    panel.setHeader(opts.header);
    panel.setBody(opts.body);

    panel.render(document.body);
    manager.register(panel);

    panel.subscribe("beforeShow", function() {clickLog(opts.log);});

    return panel;
};

/************************************************************************************
 * More Button
 ************************************************************************************/


var MoreControl = function(name, title) {
    MapControl.call(this, name, title);
    this.name = name;
    this.title = title;
    this.count = 0;
};

MoreControl.prototype = new MapControl();

MoreControl.prototype.buildMouseover = function() {
    var mouseover_container = this.mouseover_container = document.createElement("div");
    Dom.addClass(mouseover_container, "more_control_mouseover");
    Dom.setStyle(mouseover_container, "width", this.name.length * 6 + 20);
    Dom.setStyle(mouseover_container, "height", "0px");
    return mouseover_container;
};

MoreControl.prototype.addMoreItem = function(title, opts) {
    var me = this,
        itemCheckboxEl = document.createElement("input"),
        itemEl = document.createElement("span"),
        textEl = document.createElement("span"),
//        textNode = document.createTextNode(title),
        width = parseInt(Dom.getStyle(this.mouseover_container, "width")),
        panel;
    width = width >= title.length * 6 + 20 ? width:title.length * 6 + 20;
    if(navigator.appVersion.toLowerCase().indexOf("win")!==-1) {
        Dom.setStyle(this.mouseover_container, "height", parseInt(Dom.getStyle(this.mouseover_container, "height")) + 14 + "px");
    } else {
        Dom.setStyle(this.mouseover_container, "height", parseInt(Dom.getStyle(this.mouseover_container, "height")) + 14 + "px");
    }
    Dom.setStyle(this.mouseover_container, "width", width + "px");
    Dom.setStyle(itemCheckboxEl, "margin", "-5px 3px 0px 0px");
    Dom.setStyle(itemCheckboxEl, "padding", "0");
    textEl.innerHTML = title;
    itemCheckboxEl.type = "checkbox";
    itemEl.appendChild(itemCheckboxEl);
    itemEl.appendChild(textEl);
    itemEl.appendChild(document.createElement("br"));
    this.controlDivMouseover.appendChild(itemEl);

    var unclick = function(hide) {
        //This looks a little weird because unclick is called twice if the checkbox is clicked.
        if(typeof opts.buildPanel !== "undefined" && hide) panel.hide();
        else me.count -= 1;
        if(me.count === 0) {
            Dom.removeClass(me.controlDivName, "mmi_highlight");
            me.controlDivName.innerHTML = "More...";
        } else me.controlDivName.innerHTML = "More...(" + me.count + ")";
        if(typeof opts.unclick !== "undefined") opts.unclick();
    };

    var click = function() {
        if(!itemCheckboxEl.checked) {
            unclick(true);
            return;
        }
        me.count += 1;
        Dom.addClass(me.controlDivName, "mmi_highlight"); 
        me.controlDivName.innerHTML = "More...(" + me.count + ")";
        if(typeof opts.buildPanel !== "undefined" && typeof panel === "undefined") {
            panel = opts.buildPanel(opts.me);
            function onBeforeHide() {
                itemCheckboxEl.checked = false;
                unclick();
            }
            panel.subscribe("beforeHide", onBeforeHide);
        }
        if(typeof panel !== "undefined") {
            panel.show();
            panel.focus();
        }
        if(typeof opts.click !== "undefined") opts.click();
    };

    itemCheckboxEl.onclick = click;
    return itemCheckboxEl;
};

/************************************************************************************
 * Crime
 ************************************************************************************/

var CrimeControl = function(moreControl, map_panel) {
    this.map_panel = map_panel;
    this.map = map_panel.map;
    this.cluster_mgr = map_panel.cluster_mgr;
    var me=this;
    this.cluster_mgr.setClusterFn("crime", function(marker_list, center_lat, center_lng, manager) {
            return me._createClusterMarker(marker_list, center_lat, center_lng, manager);
    });

    this.init();
    this.checkbox = moreControl.addMoreItem("Crime", {buildPanel:this.buildPanel, me:this});
};

CrimeControl.prototype.init = function() {
    this.markers = {};
    this.filters = {};
    this.active_city;
    this.block = false;

    this.map_options_data = [{text:"&nbsp;Assault", img:"http://chart.apis.google.com/chart?cht=itr&chs=16x16&chco=FF0000,000000ff,ffffff01&chl=A&chx=000000,10&chf=bg,s,00000000&ext=.png", type:"A"},
                             {text:"&nbsp;Shots fired or heard", img:"http://chart.apis.google.com/chart?cht=itr&chs=16x16&chco=FF0000,000000ff,ffffff01&chl=Sh&chx=000000,10&chf=bg,s,00000000&ext=.png", type:"Sh"},
                             {text:"&nbsp;Investigate dead body", img:"http://chart.apis.google.com/chart?cht=itr&chs=16x16&chco=FF0000,000000ff,ffffff01&chl=De&chx=000000,10&chf=bg,s,00000000&ext=.png", type:"De"},
                             {text:"&nbsp;Burglary or theft", img:"http://chart.apis.google.com/chart?cht=itr&chs=16x16&chco=E68D00,000000ff,ffffff01&chl=B&chx=000000,10&chf=bg,s,00000000&ext=.png", type:"B"},
                             {text:"&nbsp;Vandalism", img:"http://chart.apis.google.com/chart?cht=itr&chs=16x16&chco=E68D00,000000ff,ffffff01&chl=V&chx=000000,10&chf=bg,s,00000000&ext=.png", type:"V"},
                             {text:"&nbsp;Drunk or reckless driver", img:"http://chart.apis.google.com/chart?cht=itr&chs=16x16&chco=E68D00,000000ff,ffffff01&chl=Dr&chx=000000,10&chf=bg,s,00000000&ext=.png", type:"Dr"},
                             {text:"&nbsp;Disturbance", img:"http://chart.apis.google.com/chart?cht=itr&chs=16x16&chco=E6E600,000000ff,ffffff01&chl=D&chx=000000,10&chf=bg,s,00000000&ext=.png", type:"D"},
                             {text:"&nbsp;Suspicious person or circumstances", img:"http://chart.apis.google.com/chart?cht=itr&chs=16x16&chco=E6E600,000000ff,ffffff01&chl=S&chx=000000,10&chf=bg,s,00000000&ext=.png", type:"S"},
                             {text:"&nbsp;Traffic related", img:"http://chart.apis.google.com/chart?cht=itr&chs=16x16&chco=E6E600,000000ff,ffffff01&chl=T&chx=000000,10&chf=bg,s,00000000&ext=.png", type:"T"},
                             {text:"&nbsp;Fraud or ID theft", img:"http://chart.apis.google.com/chart?cht=itr&chs=16x16&chco=BFBFBF,000000ff,ffffff01&chl=F&chx=000000,10&chf=bg,s,00000000&ext=.png", type:"F"},
                             {text:"&nbsp;Missing person", img:"http://chart.apis.google.com/chart?cht=itr&chs=16x16&chco=BFBFBF,000000ff,ffffff01&chl=M&chx=000000,10&chf=bg,s,00000000&ext=.png", type:"M"},
                             {text:"&nbsp;Other", img:"http://chart.apis.google.com/chart?cht=itr&chs=16x16&chco=BFBFBF,000000ff,ffffff01&chl=O&chx=000000,10&chf=bg,s,00000000&ext=.png", type:"O"}];

    this.city_list = ["Aliso Viejo", "Anaheim", "Buena Park", "Costa Mesa", "Coto De Caza", "Cypress", "Dana Point", 
                      "El Toro", "Fairgrounds", "Foothill Ranch", "Fountain Valley", "Fullerton", "Garden Grove", "Huntington Beach", "Irvine",
                      "John Wayne Airport", "La Habra", "La Mirada", "La Palma", "Ladera Ranch", "Laguna Beach", "Laguna Hills", "Laguna Niguel",
                      "Laguna Woods", "Lake Forest", "Las Flores", "Los Alamitos", "Midway City", "Mission Viejo", "Newport Beach", "Newport Beach Harbor",
                      "Orange", "University Areas", "Placentia", "Rancho Santa Margarita", "Rossmoor", "San Clemente", "San Juan Capistrano", "Santa Ana",
                      "Seal Beach", "Silverado Canyon", "Stanton", "Sunset Beach", "Trabuco Canyon", "Tustin", "Villa Park",
                      "Westminster", "Yorba Linda"];


    this.city_map = {"Aliso Viejo": "AVLN", "Anaheim": "North", "Brea": "North", "Buena Park": "North", "Costa Mesa": "North", 
                     "Coto De Caza": "Canyons", "Cypress": "North", "Dana Point": "South", "El Toro": "Canyons", 
                     "Foothill Ranch": "Canyons", "Fountain Valley": "North", "Fullerton": "North", "Garden Grove": "North", 
                     "Huntington Beach": "North", "Irvine": "North","La Habra": "North", "La Mirada": "North", "La Palma": "North", 
                     "Ladera Ranch": "Canyons", "Laguna Beach": "AVLN", "Laguna Hills": "Saddleback", "Laguna Niguel": "AVLN", 
                     "Laguna Woods": "Saddleback", "Lake Forest": "Saddleback", "Las Flores": "Canyons", "Los Alamitos": "North", 
                     "Midway City": "North", "Mission Viejo": "Saddleback", "Newport Beach": "North", "Newport Coast": "North", 
                     "Orange": "North", "Placentia": "North", "Rancho Santa Margarita": "Canyons", "Rossmoor": "North", 
                     "San Clemente": "South", "San Juan Capistrano": "South", "Santa Ana": "North", "Seal Beach": "North", 
                     "Silverado": "Canyons", "South Coast": "South", "Stanton": "North", "Sunset Beach": "North", 
                     "Trabuco": "Canyons", "Tustin": "North", "Villa Park": "North","Westminster": "North", "Yorba Linda": "North"};
};
    
CrimeControl.prototype.setActiveCity = function(city) {
    this.active_city = city;
};

CrimeControl.prototype.setBrowseDate = function(year, month, day) {
    this.year = year;
    this.month = month;
    this.day = day;
    if(parseInt(this.month) < 10) {
        this.month = "0" + this.month;
    }
    if(parseInt(this.day) < 10) {
        this.day = "0" + this.day;
    }
};

CrimeControl.prototype.moveEnd = function() {
    var me = this;
    me.map_panel.getCenterCity(me.city_map, function(city) {
                                                if(city) me.getIncidentsByCity(city);} );
};

CrimeControl.prototype.setCalendarDate = function(date) {
 //   this.cal.cfg.setProperty("maxdate", date.month + "/" + date.day + "/" + date.year);
//    this.cal.render();
};

CrimeControl.prototype.buildPanel = function(me) {
    if(typeof me === "undefined") {
        me = this;
    }
    if(typeof me.panel !== "undefined") {
        return me.panel;
    }

    var mainDiv = document.createElement("div");
    var calendarEl = document.createElement("div");
        calendarEl.id = "MMI_crime_calender_el";
    var formEl = document.createElement("form");

    function inputClick(inputEl, type) {
        return function() {if(inputEl.checked) me.show(type);
                           else me.hide(type);};
    }

    formEl.id = formEl.name = "MMI_map_options_form2";

    var inputEls = [];
    var i,
        item;
    for(i=0, item; item = me.map_options_data[i]; i++){
        var inputEl = document.createElement("input");
        var imgEl = document.createElement("img");
        var textEl = document.createElement("span");
        textEl.innerHTML = item.text;
        inputEl.type = "checkbox";
        inputEl.checked = true;
        imgEl.src = item.img;
        inputEl.onclick = inputClick(inputEl, item.type);
        inputEls.push(inputEl);

        formEl.appendChild(inputEl);
        formEl.appendChild(imgEl);
        formEl.appendChild(textEl);
        formEl.appendChild(document.createElement("br"));
    }
    var disclaimerEl = document.createElement("span");
    disclaimerEl.innerHTML = '<br><p style="width: 250px; outline: 1px solid; padding:4px">This shows only calls to the O.C. Sheriff\'s Department. Not every call resulted in an arrest or report.</p>';
    formEl.appendChild(disclaimerEl);

    var explainerEl = document.createElement("span");
    explainerEl.id = "MMI_explainer_el";
    explainerEl.innerHTML = "<p>Calls from the last 24 hours are shown. Use the calendar to show calls on a particular day.</p>";

    mainDiv.appendChild(formEl);
    for(i=0, item; item = inputEls[i]; i++) item.checked = true;
    mainDiv.appendChild(explainerEl);
    mainDiv.appendChild(calendarEl);

    var header = "Crime",
        panel = createPanel({body:mainDiv, header:header, width:"500px", height:"350px", log:"crime", context: ["ocr-resize-panel1", "tl", "tl"]});

    function handleSelect(type, args /*, obj*/) { 
        var dates = args[0]; 
        var date = dates[0];
        var year = date[0], month = date[1], day = date[2];
        me.clear();
        me.setBrowseDate(year, month, day);
        me.getIncidentsByCity(me.active_city);
    }

    var cal = this.cal = new YAHOO.widget.Calendar("cal", calendarEl, {mindate:"7/26/2009",
								  maxdate:"7/26/2009"});
    cal.render();
    cal.selectEvent.subscribe(handleSelect, cal, true);

    panel.subscribe("beforeShow", function() { me.moveEnd();
                                               me.show(); 
                                               me.moveHandler = me.map.addListener("dragend", function() {me.moveEnd();});
                                              });  
    panel.subscribe("beforeHide", function() { me.hide(); google.maps.event.removeListener(me.moveHandler);});  

    me.panel = panel;
    return panel;
};

CrimeControl.prototype.resetCheckboxes = function() {
      //elements[0] is the fieldset
    var formEl = document.getElementById("MMI_map_options_form2");
    for(var item in formEl.elements) item.checked = true;
};

CrimeControl.prototype.getIncidentsByCity = function(city) {
    if(this.block) return;  //so we'll only get markers once.
    this.block = true; 
    this.setActiveCity(city);

    if(typeof this.markers[city] !== "undefined") {
        this.block = false;
        return;
    } else this.markers[city] = []; 
    var date = new Date();
    this.map_panel.showLoading();
    var errorFunction = function() {
          this.map_panel.hideLoading();
    };

    city = city.toLowerCase().replace(/ /g, "_");
    var filename = city + "/" + ((typeof this.year === "undefined")?"current.js":this.year + "/" + this.month + "/" + this.day + ".js");
    var loadingTimeout = setTimeout(errorFunction, 200000);   

    var get_url = "http://mallocs.s3.amazonaws.com/crime/" + filename + "?uncache=" + date.getTime();

    Get.script(get_url, {
        onSuccess: function(/*o*/) { clearTimeout(loadingTimeout); },
        onFailure: errorFunction,
        onTimeout: errorFunction});
};

CrimeControl.prototype.getIncidentsByCityList = function(city_list) {
    for(var i=0, city; city=city_list[i]; i++) { 
        this.getIncidentsByCity(city);
    }
};

CrimeControl.prototype.clear = function() {
//    this.cluster_mgr.clear("crime");
  //  this.hide();
//    this.markers = {};
};

CrimeControl.prototype.show = function(type) {
    this.cluster_mgr.show("crime", type);
    if((typeof type === "undefined" || type === "refresh") && typeof this.serviceMessage !== "undefined") {
        if(typeof this.panel !== "undefined") this.resetCheckboxes();
        Dom.setStyle(this.map_panel.serviceMessageEl, "display", "block");
        Dom.setStyle(this.map_panel.footerMessageEl, "display", "none");
        this.map_panel.serviceMessageEl.innerHTML = this.serviceMessage;
    }
    return;
    /****
    if(typeof type !== "undefined") {
        this.filters[type] = false;
    }

    for(var city in this.markers) {
        for(var i=0, marker; marker=this.markers[city][i]; i++) {
//            if(!this.filters[marker.type] && (typeof type == "undefined" || type == marker.type)) this.cluster_mgr.addMarker(marker.marker, {type: {"crime": marker.type}});
//this.map.addOverlay(marker.marker);
        }
    }

//    this.cluster_mgr.refresh();
    this.cluster_mgr.show();
    ****/
};

CrimeControl.prototype.hide = function(type) {
    if(typeof type === "undefined") {
        Dom.setStyle(this.map_panel.serviceMessageEl, "display", "none");
        Dom.setStyle(this.map_panel.footerMessageEl, "display", "block");
    }
    this.cluster_mgr.hide("crime", type);
    return;
    /***
    if(typeof type !== "undefined") {
        this.filters[type] = true;
    }
    for(var city in this.markers) {
        for(var i=0, marker; marker=this.markers[city][i]; i++) {
            if(typeof type === "undefined" || type === marker.type) this.cluster_mgr.removeMarker(marker.marker);
//this.map.removeOverlay(marker.marker);
        }
    }
    ***/
};

CrimeControl.prototype.getSeverity = function(type) {
    if(type === "A" || type === "Sh" || type === "De") {
        return 4;
    } else if(type === "B" || type === "V" || type === "Dr") {
        return 3;
    } else if(type === "D" || type === "S" || type === "T" ) {
        return 2;
    } else if(type === "F" || type === "M" || type === "O") {
        return 1;
    } 
    return 0;
};

CrimeControl.prototype._createIncidentIcon = function(tag, severity, color) {
    var image,
        color;
    if(typeof tag === "undefined") {
        tag = "O";
    } 

    if(typeof severity === "undefined") {
        severity = this.getSeverity(tag);
    }

    if(typeof color === "undefined") {
        if (severity === 4) color = "FF0000";
        else if (severity === 3) color = "E68D00";
        else if (severity === 2) color = "E6E600";
        else color = "BFBFBF";
    }

    image = "http://chart.apis.google.com/chart?cht=itr&chs=16x16&chco=" + 
             color + ",000000ff,ffffff01&chl=" + tag + "&chx=000000,10&chf=bg,s,00000000&ext=.png";

    var icon_opts = {"size": new google.maps.Size(16, 16), 
                     "anchor": new google.maps.Point(8, 8), 
                     "origin": new google.maps.Point(8, 8),
                     "url": image};

/**
    if(typeof tag === "number" && tag >= 10) {
        image = "http://chart.apis.google.com/chart?cht=itr&chs=22x16&chco=" + 
                color + ",000000ff,ffffff01&chl=" + tag + "&chx=000000,10&chf=bg,s,00000000&ext=.png";
        icon_opts.url = image;
        icon_opts.size = new google.maps.Size(22, 16);
    }
**/
    if(typeof tag === "number") {
        if(tag >= 100) {
            icon_opts.url = "http://chart.apis.google.com/chart?cht=it&chs=36x36&chco=" + 
                            color + ",000000ff,ffffff01&chl=" + tag + 
                            "&chx=000000,14&chf=bg,s,00000000&ext=.png";
            icon_opts.size = new google.maps.Size(36, 36);
            icon_opts.anchor = new google.maps.Point(18, 18);
            icon_opts.origin = new google.maps.Point(18, 18);
        } else if(tag >= 10) {
            icon_opts.url = "http://chart.apis.google.com/chart?cht=it&chs=26x26&chco=" + 
                            color + ",000000ff,ffffff01&chl=" + tag + 
                            "&chx=000000,12&chf=bg,s,00000000&ext=.png";
            icon_opts.size = new google.maps.Size(26, 26);
            icon_opts.anchor = new google.maps.Point(13, 13);
            icon_opts.origin = new google.maps.Point(13, 13);
        } else {
            icon_opts.url = "http://chart.apis.google.com/chart?cht=it&chs=20x20&chco=" + 
                            color + ",000000ff,ffffff01&chl=" + tag + 
                            "&chx=000000,10&chf=bg,s,00000000&ext=.png";
            icon_opts.size = new google.maps.Size(20, 20);
            icon_opts.anchor = new google.maps.Point(10, 10);
            icon_opts.origin = new google.maps.Point(10, 10);
        }
    }

    return icon_opts;
};

CrimeControl.incidentSeverityBump = function(marker /*, b*/) {
 //   var current_zindex = GOverlay.getZIndex(marker.getPoint().lat());
    var current_zindex = marker.getZIndex();

    if(marker.type === "F" || marker.type === "M") {
        current_zindex = current_zindex + 2000000;
    } else if(marker.type === "B" || marker.type === "V" || marker.type === "Dr") {
        current_zindex = current_zindex + 3000000;
    } else if(marker.type === "A" || marker.type === "Sh" || marker.type === "De") {
        current_zindex = current_zindex + 4000000;
    } else {
        current_zindex = current_zindex + 1000000;
    }
    return current_zindex;
};

CrimeControl.prototype._createInfowindowContent = function(incident) {
    var me = this;
    var htmlEl = document.createElement("div");
    var htmlSpan = document.createElement("span");
    var html = "<b>" + incident.type + "</b><br>" +
               incident.location + ", " + incident.city +
               "<br>Call Received: " + incident.time_received +
               "<br>Call Dispatched: " + incident.time_dispatched;

    htmlSpan.innerHTML = html;
    htmlEl.appendChild(htmlSpan);

    if(typeof incident.notes !== "undefined") {
        htmlEl.appendChild(document.createElement("br"));
        var maximizeEl = document.createElement("span");
        Dom.addClass(maximizeEl, "mmi_maximize_el");
        maximizeEl.innerHTML = "more>>";
        maximizeEl.onclick = function() {var iw = me.map.getInfoWindow(); iw.maximize();};
        htmlEl.appendChild(maximizeEl);
    }

    return htmlEl;
};

CrimeControl.prototype._createInfowindowMaxContent = function(incident) {
    var htmlEl = document.createElement("div");
    var html = "<b>" + incident.type + "</b><br><br>";
        html += "<b>Location: </b>" + incident.location + ", " + incident.city + "<br><br>";
        html += "<b>Call received: </b>" + incident.time_received + "<br><br>";
        html += "<b>Call dispatched: </b>" + incident.time_dispatched + "<br><br>";
        html += "<b>Incident notes:</b><br>";
        for(var i=0, note; note=incident.notes[i]; i++) {
            //uses a bad hack to get rid of day reference in incident note. Should delete on server side.
            if(note[0] != null)
                html += "&nbsp;&nbsp;&nbsp;" + note[0].substring(0, note[0].lastIndexOf(".") + 1) + ": " + note[1] + "<br>";
            else
                html += "&nbsp;&nbsp;&nbsp;" + note[1] + "<br>";
        }
    html += '<br><br>Source: <a href="http://www.ocsd.org/e_services/sheriffs_blotter/">Orange County Sheriff\'s Department Blotter';
    htmlEl.innerHTML = html;
    return htmlEl;
};

CrimeControl.prototype._createClusterMarker = function(marker_list, center_lat, center_lng, manager) {
    var me=this, 
        severity,
        marker,
        markerSpan;
    var htmlEl = document.createElement("div");

    function markerClickClosure(marker) {
        return function() {google.maps.event.trigger(marker, "click");};
    }
    
    severity=0;
    for(var i=0; marker=marker_list[i]; i++) {
        severity += this.getSeverity(marker.subtype) - 1;
        if(this.getSeverity(marker.subtype) == 1) severity += 1;
        if(i <= 10) {
            markerSpan = document.createElement("span");
            markerSpan.innerHTML = '<b>' + marker.title + '</b><br>';
            markerSpan.onclick = markerClickClosure(marker);
            Dom.addClass(markerSpan, "mmi_jslink");
            htmlEl.appendChild(markerSpan);
        } 
    }
    
    if(marker_list.length > 10) {
        markerSpan = document.createElement("span");
        markerSpan.innerHTML = (marker_list.length - 10) + " more crime calls in this area. Zoom in for details.";
        htmlEl.appendChild(markerSpan); 
    }
    
    var hex = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];
    severity = severity/marker_list.length;
    var color = 15 - parseInt(Math.floor(severity*5));
    if(color < 4) {
        color = "ff" + hex[color] + "100";
    } else if(color < 16){
        color = "e6" + hex[color] + "d00";
    } else {
        color = "e6f600";
    }
    
    marker = this.cluster_mgr.createMarker({"position": new google.maps.LatLng(center_lat, center_lng),
                                            "title": marker_list.length + " calls",
                                            "content": htmlEl,
                                            "icon": this.cluster_mgr.createClusterIcon(marker_list.length, manager.getPrecision()-5, color, "000000")
                                           });
 //                                           "icon": this._createIncidentIcon(marker_list.length, severity)}
    
    marker.summary = marker_list.length + " calls";
    return marker;
};

CrimeControl.prototype.processIncidents = function(incident_list, timestamp, timedetails) {
    var me = this;
    this.map_panel.hideLoading();
    if(typeof timedetails !== "undefined") {
        this.setCalendarDate(timedetails);
        this.serviceMessage = "<b>Crime calls updated: " + timestamp + "</b>";
    }
    var maxContent,
        maxTitle,
        marker,
        marker_list = [];
    for(var i=0, incident; incident=incident_list[i]; i++){
        var icon = this._createIncidentIcon(incident.icon);
        if(typeof incident.notes !== "undefined") {
            maxContent = this._createInfowindowMaxContent(incident);
            maxTitle = incident.type;
        } else {
            maxContent = null;
            maxTitle = null;
        }

        marker = this.cluster_mgr.createMarker({ "position": new google.maps.LatLng(incident.latitude, incident.longitude),
                                                     "title": incident.type, 
                                                      "visible" : true,
//                                                    "type": incident.icon, 
                   //                                 "zIndexProcess": CrimeControl.incidentSeverityBump}
                    //                                "maxContent": maxContent,
                                                     "type": "crime", 
                                                     "subtype": incident.icon, 
                                 //                    "summary": incident.icon,
                                                     "content": this._createInfowindowContent(incident), 
                                                     "icon": icon
                                                   });
        this.cluster_mgr.addMarker(marker);

        /*
        var marker = this.cluster_mgr.createMarker(incident.latitude, incident.longitude, {"title": incident.type, 
                                                                          "maxTitle": maxTitle, 
                                                                          "type": incident.icon, 
                                                                          "content": this._createInfowindowContent(incident), 
                                                                          "maxContent": maxContent,
                                                                          "icon": icon, 
                                                                          "zIndexProcess": CrimeControl.incidentSeverityBump});
        */
//        this.map.addOverlay(marker);
//        this.cluster_mgr.addMarker(marker, {"crime": incident.icon});
//        this.cluster_mgr.addMarker(marker, {type: {"crime": incident.icon}});
 //       this.markers[this.active_city].push({marker: marker, type: incident.icon});
//        this.map.removeOverlay(marker);
    }
//    this.cluster_mgr.cluster("crime", function(marker_list) {return me._createClusterMarker(marker_list);});
    this.show();
    this.block = false;
};

/*************************************************************************************
 * callback functions
 *************************************************************************************/

var sheriffCallback = function(incident_list, map_id) {
    var map = OCRPanel.getById(map_id);
    map.crimeControl.processIncidents(incident_list[0], incident_list[1], incident_list[2]);
};

window.sheriffIncidentsCallback = function(incident_list) {
    var map_id = "ocr-resize-panel1";
    sheriffCallback(incident_list, map_id);
};

/*************************************************************************************
 * This is initialization stuff
 *************************************************************************************/

YAHOO.OCRPanel.findRelNodes = function(doc, tagName, relValue) {
    var foundNodes = [];
    var nodes = doc.getElementsByTagName(tagName);
    for(var n = 0, node; n < nodes.length; n++) {
        node = nodes[n];
        if(node.getAttribute("rel") === relValue) {
            foundNodes.push(node);
        }
    }
    return foundNodes;
};

YAHOO.OCRPanel.findPanelNodes = function(doc, idBase) {
    var count = 1;
    var nodeList = [];
    var node = doc.getElementById(idBase + count);
    while(node) {
        nodeList.push(node);
        count++;
        node = doc.getElementById(idBase + count);
    }
    return nodeList;
};

YAHOO.OCRPanel.getSectionColor = function() {
    var sectionColor = Dom.getStyle("basenav", "backgroundColor");
    return sectionColor?sectionColor:"#224477";
};

function init(legacy) {

    var linkNodes,
        linkNode;
    if(typeof legacy==="undefined") {
        linkNodes = YAHOO.OCRPanel.findPanelNodes(document, "ocr-resize-panel");
    } else {
        //this is how panels used to be defined.
        linkNodes = YAHOO.OCRPanel.findRelNodes(document, "div", "panel/data");
    }
    for(var i=0; linkNode = linkNodes[i]; i++) {
        var panelConfig = {
            visible:true, 
            underlay:"shadow", 
            constraintoviewport:false, 
            close:false, 
            draggable:true,
            width:parseInt(linkNode.getAttribute("width")) + "px",
            height:parseInt(linkNode.getAttribute("height")) + "px",
            zIndex:1,
            iframe:false,
            id: "" + Dom.generateId(undefined, "ocr-resize-panel"),
            center:linkNode.getAttribute("center"),
            content:linkNode.getAttribute("content"),
            layers:eval(linkNode.getAttribute("layers")),
            type:linkNode.getAttribute("type"),
            zoom:linkNode.getAttribute("zoomLevel"),
            traffic:linkNode.getAttribute("traffic"),
            crime:linkNode.getAttribute("crime"),
            restaurants:linkNode.getAttribute("restaurants"),
            more:linkNode.getAttribute("more"),
            realestate:linkNode.getAttribute("realestate"),
            footer_message:linkNode.getAttribute("footer_message"),
            src:linkNode.getAttribute("src"),
//            talk:linkNode.getAttribute("talk"),
//            realestate:"false",
//            crime:"true",
//            restaurants:"true",
//            more:"true",
//            traffic:"true",
//            talk:"false",
            talk:"coff,http://www2.ocregister.com/newsimages/Graphics/mapicons/coyote.png",
            header_color:YAHOO.OCRPanel.getSectionColor()
        };

        var pageHole = document.createElement("div");
        linkNode.parentNode.insertBefore(pageHole, Dom.getNextSibling(linkNode));
        pageHole.style.height = parseInt(panelConfig.height) + 4 + "px"; 
        pageHole.style.width = parseInt(panelConfig.width) + 4 + "px";
        panelConfig.pageHole = pageHole;

        linkNode.innerHTML = ""; //there should be a loading indicator in the html and this will clear it out.

        var panel = new OCRPanel(linkNode, panelConfig);
        panel.render();

        //need to grab click events before they escape the map so other handlers don't make
        //the map start acting weird.
        Event.addListener(linkNode, "click", function() { OCR_CLICK_COUNTER += 1; if(window.event) window.event.cancelBubble = true;} );
//        GEvent.addListener(panel.map, "infowindowopen", function() { MARKER_CLICK_COUNTER += 1;});
    }
 //   Event.addListener(window, "unload", function() { clickLog("unload"); delete panel; delete pageHole; delete linkNode;} );
//    Event.addListener(window, "unload", function() { clickLog("unload"); GUnload(); delete panel; delete pageHole; delete linkNode;} );
    clickLog("load");
    return;
}
window.OCR_RESIZE_PANEL_INIT = function(legacy) {
    init(legacy);
};

//This configures the init listener. Old style, assume the panel has the
//ID 'news-panel'. New style, there may be multiple panels, with the last
//in the HTML with ID 'ocr-resize-panel1' and the others above it in the
//HTML labeled 'ocr-resize-panel2', etc. This is the fastest I can come up
//with since we can't search the whole HTML page before it loads, and this
//makes sure we start loading as soon as possible, when the last panel div
//has been reached.
var configInit = function() {
    //This script is guaranteed to be in the DOM when we execute this, so we can check if
    //it has an ID which is just a way to check whether it's a legacy script or not.
    var panelScriptEl = document.getElementById("ocr-resize-panel-script");

    if(panelScriptEl) {
        Event.onAvailable("ocr-resize-panel1", function() {OCR_RESIZE_PANEL_INIT();});
    } else {
        Event.onAvailable("news-panel", function() {OCR_RESIZE_PANEL_INIT(true);});
    }
}();

})();