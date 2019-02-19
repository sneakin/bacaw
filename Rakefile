require 'pathname'
require 'shellwords'
require 'rbconfig'

root = Pathname.new(__FILE__).parent.expand_path
buildroot ||= ENV.fetch('BUILDROOT', root.join('build'))

$: << root.parent.join('lib')
$: << root.join('vendor/rake-node/lib')
require 'rake/browserify'

NODE_PATH << [ root.join('js', 'lib').to_s,
               root.join('www').to_s
             ]
outputs = [ 'index.html',
            'index.css',
            'dev.html',
            'dev_style.css',
            'doc/index.html',
            'style.css',
            'tabs.css',
            'xterm.css',
            'images/unscii-8.png',
            'images/unscii-16.png'
          ].collect do |src|
  buildroot.join(src)
end

directory buildroot
directory buildroot.join('doc') => buildroot
directory buildroot.join('images') => buildroot

[ 'style.css',
  'tabs.css',
  'dev_style.css',
  'index.css',
  'images/unscii-8.png',
  'images/unscii-16.png'
].each do |name|
  output = buildroot.join(name)
  src = root.join('www', name)
  
  file output => [ src, buildroot, File.dirname(output) ] do |t|
    FileUtils.copy(t.sources[0], t.name)
  end
end

file buildroot.join('xterm.css') => root.join('node_modules', 'xterm', 'dist', 'xterm.css') do |t|
  FileUtils.copy(t.sources[0], t.name)
end

BrowserifyRunner.root = root
BrowserifyRunner.bundle buildroot.join('dev.js') => [ root.join('www/dev.js') ]
BrowserifyRunner.bundle buildroot.join('doc/doc.js') => [ root.join('www/doc/doc.js') ]

html_file buildroot.join('index.html') => [ root.join('www/index.src.html'), buildroot ]
html_file buildroot.join('dev.html') => [ root.join('www/dev.src.html'), buildroot.join('dev.js'), buildroot ]
html_file buildroot.join('doc/index.html') => [ root.join('www/doc/index.src.html'), buildroot.join('doc/doc.js'), buildroot.join('doc') ]

desc 'Start a webserver on port 9090 to serve the build directory.'
task :serve do
	require 'webrick'
  $stderr.puts("Serving on #{buildroot}")
	s = WEBrick::HTTPServer.new(:Port => 9090, :DocumentRoot => buildroot)
	trap('INT') { s.shutdown }
	s.start
end

namespace :bacaw do
  task :default => [ buildroot, *outputs ]

  desc 'Remove all built files'
  task :clean do
    sh("rm -rf #{Shellwords.escape(buildroot.to_s)}")
  end

  task :console do
    ENV['NODE_PATH'] = NODE_PATH
    sh("node #{Shellwords.escape(root.join('bin', 'bccon.js'))} #{ENV.fetch('CMD')}")
  end
end

task :default => 'bacaw:default'
task :clean => 'bacaw:clean'
