require 'pathname'
require 'shellwords'
require 'rbconfig'

root = Pathname.new(__FILE__).parent.expand_path
buildroot ||= ENV.fetch('BUILDROOT', root.join('build'))

$: << root.parent.join('lib')
require 'tasks'

outputs = [ 'index.html',
            'runner.html',
            'dev.html',
            'doc/index.html',
            'style.css',
            'runner_style.css',
            'dev_style.css'
          ].collect do |src|
  buildroot.join(src)
end

directory buildroot
directory buildroot.join('doc') => buildroot

[ 'style.css',
  'runner_style.css',
  'dev_style.css'
].each do |src|
  output = buildroot.join(src)
  src = root.join('www', src)
  
  file output => [ src, buildroot ] do |t|
    FileUtils.copy(t.sources[0], t.name)
  end
end

BrowserifyRunner.root = root
BrowserifyRunner.bundle buildroot.join('runner.js') => [ root.join('www/runner.js') ]
BrowserifyRunner.bundle buildroot.join('dev.js') => [ root.join('www/dev.js') ]
BrowserifyRunner.bundle buildroot.join('doc/doc.js') => [ root.join('www/doc/doc.js') ]

html_file buildroot.join('index.html') => [ root.join('www/index.src.html'), buildroot ]
html_file buildroot.join('runner.html') => [ root.join('www/runner.src.html'), buildroot.join('runner.js'), buildroot ]
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